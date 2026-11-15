using System.Globalization;
using ExcavationApi.Contracts;
using ExcavationApi.Data;
using ExcavationApi.Domain;
using Oracle.ManagedDataAccess.Client;

namespace ExcavationApi.Services;

/// <summary>
/// Pre-review analysis of an excavation request:
///  1. pure C# validation (RequestValidator)
///  2. Oracle: geometry validity, geodesic length, buffer (route -> area polygon), geodesic area
///  3. Oracle: inside Jeddah boundary
///  4. Oracle: spatio-temporal conflicts (+ dig-once suggestion in C#)
///  5. Oracle: sensitive sites within N metres, recently paved roads crossed
/// All geometry is SRID 4326 (geodetic), so lengths/areas/distances are on the ellipsoid, in metres.
/// INDEX hints keep the spatial index in use even on the tiny seed tables (see database/queries/explain_plan.sql).
/// </summary>
public sealed class AnalysisService(OracleDb db, IConfiguration config, ILogger<AnalysisService> logger)
{
    private const string BufferParams = "unit=M arc_tolerance=0.5";
    private double SensitiveDistance => config.GetValue("Analysis:SensitiveDistanceMeters", 50.0);
    private int PavedMonths => config.GetValue("Analysis:PavedProtectionMonths", 12);

    public static ExcavationInput ToInput(AnalyzeRequest r) => new(
        r.Paths?.Select(p => (IReadOnlyList<double[]>)p).ToList(), r.WidthMeters, r.StartDate, r.EndDate, r.WorkType, r.Notes);

    public async Task<(AnalysisResult Result, string? Wkt)> AnalyzeAsync(AnalyzeRequest request, string? myAgencyName, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        var input = ToInput(request);
        var errors = RequestValidator.Validate(input, today, isNewRequest: true);
        if (errors.Count > 0) return (new AnalysisResult { Errors = errors }, null);

        var wkt = WktBuilder.Build(input.Paths!);
        var halfWidth = request.WidthMeters / 2;

        await using var conn = await db.OpenAsync(ct);

        // ---- 1. Geometry validity (Oracle's own rules: duplicate points, too few vertices...)
        var validity = await ScalarStringAsync(conn,
            "SELECT SDO_GEOM.VALIDATE_GEOMETRY_WITH_CONTEXT(SDO_GEOMETRY(:wkt, 4326), 0.05) AS v FROM dual", wkt, ct);
        if (validity != "TRUE")
            return (new AnalysisResult { Errors = ["شكل المسار غير صالح (مثلاً نقاط مكررة أو خط يتقاطع مع نفسه). أعد رسمه."] }, null);

        // ---- 2. Geodesic length + buffer + geodesic area in one round trip
        double? length = null, area = null;
        System.Text.Json.JsonElement? areaGeoJson = null;
        await using (var cmd = OracleDb.Command(conn, $"""
            WITH g AS (SELECT SDO_GEOMETRY(:wkt, 4326) AS route FROM dual),
                 b AS (SELECT route, SDO_GEOM.SDO_BUFFER(route, :half_width, 0.05, '{BufferParams}') AS area FROM g)
            SELECT ROUND(SDO_GEOM.SDO_LENGTH(route, 0.05, 'unit=M'), 2) AS length_m,
                   ROUND(SDO_GEOM.SDO_AREA(area, 0.05, 'unit=SQ_M'), 2) AS area_m2,
                   SDO_UTIL.TO_GEOJSON(area)                           AS area_geojson
            FROM b
            """).AddWkt(wkt).Add("half_width", OracleDbType.Decimal, halfWidth))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            if (await r.ReadAsync(ct))
            {
                length = r.Dbl("length_m");
                area = r.Dbl("area_m2");
                areaGeoJson = r.GeoJson("area_geojson");
            }
        }

        // ---- 3. Inside the Jeddah boundary (CONTAINS or COVERS = fully inside)
        await using (var cmd = OracleDb.Command(conn, """
            SELECT /*+ INDEX(c city_geom_sidx) */ COUNT(*) AS n FROM city_boundary c
            WHERE SDO_RELATE(c.geom, SDO_GEOMETRY(:wkt, 4326), 'mask=CONTAINS+COVERS') = 'TRUE'
            """).AddWkt(wkt))
        {
            if (Convert.ToInt32(await cmd.ExecuteScalarAsync(ct)) == 0)
                errors.Add("المسار يقع خارج حدود محافظة جدة (كلياً أو جزئياً).");
        }

        var mine = new DateRange(request.StartDate, request.EndDate);
        var conflicts = await ConflictsAsync(conn, wkt, halfWidth, mine, excludeId: null, myAgencyName, ct);
        var sites = await SensitiveSitesAsync(conn, wkt, ct);
        var paved = await PavedRoadsAsync(conn, wkt, halfWidth, ct);

        var result = new AnalysisResult
        {
            Errors = errors,
            LengthMeters = length,
            AreaSquareMeters = area,
            AreaGeoJson = areaGeoJson,
            Conflicts = conflicts,
            SensitiveSites = sites,
            PavedRoads = paved,
            Warnings = BuildWarnings(conflicts, sites, paved),
        };
        return (result, wkt);
    }

    /// <summary>Conflicts of an already-saved request (its own row excluded).</summary>
    public async Task<List<ConflictDto>> ConflictsForExistingAsync(
        int id, string routeWkt, double widthMeters, DateRange range, string agencyName, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        return await ConflictsAsync(conn, routeWkt, widthMeters / 2, range, id, agencyName, ct);
    }

    // ------------------------------------------------------------------ queries

    /// <summary>
    /// Spatio-temporal conflict = the excavation AREAS interact in space (SDO_RELATE ANYINTERACT,
    /// served by the spatial index EXCAV_AREA_SIDX) AND the date ranges overlap.
    /// Returns the overlap polygon (SDO_INTERSECTION) and its geodesic area.
    /// </summary>
    private async Task<List<ConflictDto>> ConflictsAsync(
        OracleConnection conn, string wkt, double halfWidth, DateRange mine, int? excludeId, string? myAgencyName, CancellationToken ct)
    {
        await using var cmd = OracleDb.Command(conn, $"""
            SELECT /*+ INDEX(e excav_area_sidx) */
                   e.id, a.name_ar, e.work_type, e.status, e.start_date, e.end_date,
                   ROUND(SDO_GEOM.SDO_AREA(SDO_GEOM.SDO_INTERSECTION(e.area_geom, q.area, 0.05), 0.05, 'unit=SQ_M'), 2) AS overlap_m2,
                   SDO_UTIL.TO_GEOJSON(SDO_GEOM.SDO_INTERSECTION(e.area_geom, q.area, 0.05)) AS overlap_geojson
            FROM excavations e
            JOIN agencies a ON a.id = e.agency_id
            CROSS JOIN (SELECT SDO_GEOM.SDO_BUFFER(SDO_GEOMETRY(:wkt, 4326), :half_width, 0.05, '{BufferParams}') AS area FROM dual) q
            WHERE SDO_RELATE(e.area_geom, q.area, 'mask=ANYINTERACT') = 'TRUE'
              AND e.status IN ('Pending', 'Approved')
              AND e.start_date <= :end_date AND e.end_date >= :start_date
              AND (:exclude_id IS NULL OR e.id <> :exclude_id)
            ORDER BY e.start_date
            """)
            .AddWkt(wkt)
            .Add("half_width", OracleDbType.Decimal, halfWidth)
            .AddDate("start_date", mine.Start)
            .AddDate("end_date", mine.End)
            .Add("exclude_id", OracleDbType.Int32, excludeId);

        var list = new List<ConflictDto>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            var other = new DateRange(r.Date("start_date"), r.Date("end_date"));
            var otherAgency = r.Str("name_ar")!;
            var digOnce = DigOncePlanner.Suggest(mine, other, myAgencyName ?? "الجهة الطالبة", otherAgency);
            list.Add(new ConflictDto(
                r.Int("id"), otherAgency, r.Str("work_type")!, r.Str("status")!,
                other.Start, other.End, mine.OverlapDays(other),
                r.Dbl("overlap_m2") ?? 0, r.GeoJson("overlap_geojson"),
                digOnce is null ? null : new DigOnceDto(digOnce.SuggestedStartDate, digOnce.SuggestedEndDate, digOnce.Message)));
        }
        return list;
    }

    /// <summary>Schools/hospitals within N metres of the route (SDO_WITHIN_DISTANCE + exact SDO_DISTANCE).</summary>
    private async Task<List<SensitiveSiteHit>> SensitiveSitesAsync(OracleConnection conn, string wkt, CancellationToken ct)
    {
        var distanceParams = FormattableString.Invariant($"distance={SensitiveDistance} unit=M");
        await using var cmd = OracleDb.Command(conn, """
            SELECT /*+ INDEX(s sens_geom_sidx) */ s.id, s.name, s.site_type,
                   ROUND(SDO_GEOM.SDO_DISTANCE(s.geom, SDO_GEOMETRY(:wkt, 4326), 0.05, 'unit=M'), 1) AS distance_m
            FROM sensitive_sites s
            WHERE SDO_WITHIN_DISTANCE(s.geom, SDO_GEOMETRY(:wkt, 4326), :distance_params) = 'TRUE'
            ORDER BY distance_m
            """).AddWkt(wkt).Add("distance_params", OracleDbType.Varchar2, distanceParams);

        var list = new List<SensitiveSiteHit>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            list.Add(new SensitiveSiteHit(r.Int("id"), r.Str("name")!, r.Str("site_type")!, r.Dbl("distance_m") ?? 0));
        return list;
    }

    /// <summary>Road segments paved in the last N months that the excavation area touches.</summary>
    private async Task<List<PavedRoadHit>> PavedRoadsAsync(OracleConnection conn, string wkt, double halfWidth, CancellationToken ct)
    {
        await using var cmd = OracleDb.Command(conn, $"""
            SELECT /*+ INDEX(p paved_geom_sidx) */ p.id, p.name, p.paved_date,
                   TRUNC(MONTHS_BETWEEN(TRUNC(SYSDATE), p.paved_date)) AS months_since
            FROM paved_roads p
            CROSS JOIN (SELECT SDO_GEOM.SDO_BUFFER(SDO_GEOMETRY(:wkt, 4326), :half_width, 0.05, '{BufferParams}') AS area FROM dual) q
            WHERE SDO_RELATE(p.geom, q.area, 'mask=ANYINTERACT') = 'TRUE'
              AND p.paved_date >= ADD_MONTHS(TRUNC(SYSDATE), -:months)
            """)
            .AddWkt(wkt)
            .Add("half_width", OracleDbType.Decimal, halfWidth)
            .Add("months", OracleDbType.Int32, PavedMonths);

        var list = new List<PavedRoadHit>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            list.Add(new PavedRoadHit(r.Int("id"), r.Str("name")!, r.Date("paved_date"), r.Int("months_since")));
        return list;
    }

    private static async Task<string?> ScalarStringAsync(OracleConnection conn, string sql, string wkt, CancellationToken ct)
    {
        await using var cmd = OracleDb.Command(conn, sql).AddWkt(wkt);
        return (await cmd.ExecuteScalarAsync(ct))?.ToString();
    }

    // ------------------------------------------------------------------ warnings (non-blocking, Arabic)

    private List<string> BuildWarnings(List<ConflictDto> conflicts, List<SensitiveSiteHit> sites, List<PavedRoadHit> paved)
    {
        var ar = CultureInfo.InvariantCulture;
        var w = new List<string>();
        foreach (var c in conflicts)
            w.Add(string.Format(ar, "تعارض مع حفرية {0} رقم {1} ({2}): تداخل زمني {3} يوم ومساحة تداخل {4:0.#} م².",
                c.AgencyName, c.ExcavationId, c.WorkType, c.OverlapDays, c.OverlapAreaSquareMeters));
        foreach (var p in paved)
            w.Add(string.Format(ar, "حماية الطرق المسفلتة حديثاً: المسار يمر بـ «{0}» الذي سُفلت قبل {1} شهر (أقل من {2} شهراً).",
                p.Name, p.MonthsSincePaving, PavedMonths));
        foreach (var s in sites)
            w.Add(string.Format(ar, "{0} «{1}» على بعد {2:0.#} م من المسار: يلزم اتخاذ احتياطات السلامة.",
                s.SiteType == "Hospital" ? "مستشفى" : "مدرسة", s.Name, s.DistanceMeters));
        if (w.Count > 0) logger.LogDebug("Analysis produced {Count} warnings", w.Count);
        return w;
    }
}
