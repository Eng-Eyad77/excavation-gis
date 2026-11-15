using System.Text.Json;
using System.Text.Json.Nodes;
using ExcavationApi.Contracts;
using Oracle.ManagedDataAccess.Client;

namespace ExcavationApi.Data;

/// <summary>Reference layers served to the map as GeoJSON FeatureCollections.</summary>
public sealed class LayerRepository(OracleDb db, IConfiguration config)
{
    private int PavedProtectionMonths => config.GetValue("Analysis:PavedProtectionMonths", 12);

    public async Task<List<AgencyDto>> AgenciesAsync(CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = OracleDb.Command(conn, "SELECT id, code, name_ar, name_en FROM agencies ORDER BY id");
        var list = new List<AgencyDto>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(new AgencyDto(r.Int("id"), r.Str("code")!, r.Str("name_ar")!, r.Str("name_en")!));
        return list;
    }

    public Task<JsonObject> SensitiveSitesAsync(CancellationToken ct) => FeatureCollectionAsync(
        "SELECT id, name, site_type, source, external_id, SDO_UTIL.TO_GEOJSON(geom) AS geojson FROM sensitive_sites ORDER BY id",
        null,
        r => new JsonObject
        {
            ["id"] = r.Int("id"),
            ["name"] = r.Str("name"),
            ["siteType"] = r.Str("site_type"),
            ["source"] = r.Str("source"),
            ["externalId"] = r.Str("external_id"),
        }, ct);

    public Task<JsonObject> PavedRoadsAsync(CancellationToken ct) => FeatureCollectionAsync(
        """
        SELECT id, name, TO_CHAR(paved_date, 'YYYY-MM-DD') AS paved_date,
               CASE WHEN paved_date >= ADD_MONTHS(TRUNC(SYSDATE), -:months) THEN 1 ELSE 0 END AS is_recent,
               SDO_UTIL.TO_GEOJSON(geom) AS geojson
        FROM paved_roads ORDER BY id
        """,
        cmd => cmd.Add("months", OracleDbType.Int32, PavedProtectionMonths),
        r => new JsonObject
        {
            ["id"] = r.Int("id"),
            ["name"] = r.Str("name"),
            ["pavedDate"] = r.Str("paved_date"),
            ["isRecent"] = r.Int("is_recent") == 1,
        }, ct);

    public Task<JsonObject> CityBoundaryAsync(CancellationToken ct) => FeatureCollectionAsync(
        "SELECT id, name, SDO_UTIL.TO_GEOJSON(geom) AS geojson FROM city_boundary ORDER BY id",
        null,
        r => new JsonObject { ["id"] = r.Int("id"), ["name"] = r.Str("name") }, ct);

    private async Task<JsonObject> FeatureCollectionAsync(
        string sql, Action<OracleCommand>? bind, Func<OracleDataReader, JsonObject> properties, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = OracleDb.Command(conn, sql);
        bind?.Invoke(cmd);

        var features = new JsonArray();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            features.Add(new JsonObject
            {
                ["type"] = "Feature",
                ["id"] = r.Int("id"),
                ["properties"] = properties(r),
                ["geometry"] = JsonNode.Parse(r.Str("geojson")!),
            });
        }
        return new JsonObject { ["type"] = "FeatureCollection", ["features"] = features };
    }
}
