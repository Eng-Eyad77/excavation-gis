using ExcavationApi.Contracts;
using Oracle.ManagedDataAccess.Client;

namespace ExcavationApi.Data;

public sealed record NewExcavation(
    int AgencyId, int CreatedBy, string WorkType, double WidthMeters,
    DateOnly StartDate, DateOnly EndDate, string? Notes, string RouteWkt,
    double LengthMeters, double AreaSquareMeters);

public sealed class ExcavationRepository(OracleDb db)
{
    // Geometry leaves Oracle as GeoJSON (SDO_UTIL.TO_GEOJSON), already in lon/lat WGS84.
    private const string SelectSql = """
        SELECT e.id, e.agency_id, a.code AS agency_code, a.name_ar AS agency_name, e.work_type,
               e.width_m, e.start_date, e.end_date, e.status, e.length_m, e.area_m2,
               e.notes, e.review_note, cu.username AS created_by, e.created_at,
               ru.username AS reviewed_by, e.reviewed_at,
               SDO_UTIL.TO_GEOJSON(e.route_geom) AS route_geojson,
               SDO_UTIL.TO_GEOJSON(e.area_geom)  AS area_geojson
        FROM excavations e
        JOIN agencies a       ON a.id  = e.agency_id
        LEFT JOIN app_users cu ON cu.id = e.created_by
        LEFT JOIN app_users ru ON ru.id = e.reviewed_by
        """;

    public async Task<List<ExcavationDto>> ListAsync(string? status, int? agencyId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = OracleDb.Command(conn, SelectSql + """
             WHERE (:status IS NULL OR e.status = :status)
               AND (:agency_id IS NULL OR e.agency_id = :agency_id)
             ORDER BY e.created_at DESC, e.id DESC
            """)
            .Add("status", OracleDbType.Varchar2, status)
            .Add("agency_id", OracleDbType.Int32, agencyId);

        var list = new List<ExcavationDto>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(Map(r));
        return list;
    }

    public async Task<ExcavationDto?> GetAsync(int id, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = OracleDb.Command(conn, SelectSql + " WHERE e.id = :id").Add("id", OracleDbType.Int32, id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? Map(r) : null;
    }

    /// <summary>The stored route as WKT, so the same conflict query can be re-run for an existing request.</summary>
    public async Task<string?> GetRouteWktAsync(int id, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = OracleDb.Command(conn,
            "SELECT SDO_UTIL.TO_WKTGEOMETRY(route_geom) AS wkt FROM excavations WHERE id = :id")
            .Add("id", OracleDbType.Int32, id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? r.Str("wkt") : null;
    }

    /// <summary>
    /// Inserts the route and its buffered area (computed by Oracle, same parameters as the analysis)
    /// and returns the new id via RETURNING ... INTO.
    /// </summary>
    public async Task<int> InsertAsync(NewExcavation e, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = OracleDb.Command(conn, """
            INSERT INTO excavations (agency_id, work_type, width_m, start_date, end_date, status,
                                     length_m, area_m2, notes, created_by, route_geom, area_geom)
            VALUES (:agency_id, :work_type, :width_m, :start_date, :end_date, 'Pending',
                    :length_m, :area_m2, :notes, :created_by,
                    SDO_GEOMETRY(:wkt, 4326),
                    SDO_GEOM.SDO_BUFFER(SDO_GEOMETRY(:wkt, 4326), :half_width, 0.05, 'unit=M arc_tolerance=0.5'))
            RETURNING id INTO :new_id
            """)
            .Add("agency_id", OracleDbType.Int32, e.AgencyId)
            .Add("work_type", OracleDbType.Varchar2, e.WorkType)
            .Add("width_m", OracleDbType.Decimal, e.WidthMeters)
            .AddDate("start_date", e.StartDate)
            .AddDate("end_date", e.EndDate)
            .Add("length_m", OracleDbType.Decimal, Math.Round(e.LengthMeters, 2))
            .Add("area_m2", OracleDbType.Decimal, Math.Round(e.AreaSquareMeters, 2))
            .Add("notes", OracleDbType.Varchar2, e.Notes)
            .Add("created_by", OracleDbType.Int32, e.CreatedBy)
            .AddWkt(e.RouteWkt)
            .Add("half_width", OracleDbType.Decimal, e.WidthMeters / 2);
        var newId = cmd.Parameters.Add("new_id", OracleDbType.Int32);
        newId.Direction = System.Data.ParameterDirection.Output;

        await cmd.ExecuteNonQueryAsync(ct);
        return Convert.ToInt32(newId.Value.ToString());
    }

    /// <summary>Approve or reject. Only Pending requests can be reviewed; returns false otherwise.</summary>
    public async Task<bool> ReviewAsync(int id, string newStatus, string? note, int reviewerId, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = OracleDb.Command(conn, """
            UPDATE excavations
               SET status = :status, review_note = :note, reviewed_by = :reviewer, reviewed_at = SYSTIMESTAMP
             WHERE id = :id AND status = 'Pending'
            """)
            .Add("status", OracleDbType.Varchar2, newStatus)
            .Add("note", OracleDbType.Varchar2, note)
            .Add("reviewer", OracleDbType.Int32, reviewerId)
            .Add("id", OracleDbType.Int32, id);
        return await cmd.ExecuteNonQueryAsync(ct) == 1;
    }

    private static ExcavationDto Map(OracleDataReader r) => new(
        r.Int("id"), r.Int("agency_id"), r.Str("agency_code")!, r.Str("agency_name")!, r.Str("work_type")!,
        r.Dbl("width_m") ?? 0, r.Date("start_date"), r.Date("end_date"), r.Str("status")!,
        r.Dbl("length_m"), r.Dbl("area_m2"), r.Str("notes"), r.Str("review_note"),
        r.Str("created_by"), r.DateTimeOrNull("created_at")!.Value,
        r.Str("reviewed_by"), r.DateTimeOrNull("reviewed_at"),
        r.GeoJson("route_geojson")!.Value, r.GeoJson("area_geojson")!.Value);
}
