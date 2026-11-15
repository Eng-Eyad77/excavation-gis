using System.Globalization;
using System.Text.Json;
using ExcavationApi.Contracts;
using ExcavationApi.Data;
using Oracle.ManagedDataAccess.Client;

namespace ExcavationApi.Services;

/// <summary>Thrown for problems the caller can fix (missing/invalid configuration, ArcGIS error).</summary>
public sealed class ArcGisSyncException(string message, int statusCode) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public sealed record ArcGisSite(string ExternalId, string Name, string SiteType, double Lon, double Lat);

/// <summary>
/// Pulls the sensitive-sites hosted feature layer (ArcGIS Feature Service) through the
/// ArcGIS REST API and upserts it into Oracle:
///   GET {layerUrl}/query?where=1=1&amp;outFields=*&amp;outSR=4326&amp;f=geojson
/// Matching is by external_id: rows that already exist (e.g. from the seed) are updated and
/// marked source='ArcGIS'; new ones are inserted.
/// </summary>
public sealed class ArcGisSyncService(HttpClient http, OracleDb db, IConfiguration config, ILogger<ArcGisSyncService> logger)
{
    public async Task<SyncResult> SyncSensitiveSitesAsync(CancellationToken ct)
    {
        var layerUrl = config["ArcGis:SensitiveSitesLayerUrl"]?.Trim().TrimEnd('/');
        if (string.IsNullOrEmpty(layerUrl))
            throw new ArcGisSyncException(
                "رابط طبقة المواقع الحساسة في ArcGIS غير مُعدّ. أضف ArcGis:SensitiveSitesLayerUrl " +
                "(مثال: https://services.arcgis.com/<org>/arcgis/rest/services/<name>/FeatureServer/0).", 400);

        if (!Uri.TryCreate(layerUrl, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && !uri.IsLoopback))
            throw new ArcGisSyncException("رابط طبقة ArcGIS غير صالح: يجب أن يكون رابط https لطبقة FeatureServer.", 400);

        var features = await QueryGeoJsonAsync(layerUrl, ct);

        var sites = new List<ArcGisSite>();
        var skipped = 0;
        foreach (var f in features)
        {
            if (MapFeature(f) is { } site) sites.Add(site);
            else skipped++;
        }
        if (skipped > 0) logger.LogWarning("ArcGIS sync skipped {Skipped} features without a point geometry or a name", skipped);

        var (imported, updated) = await UpsertAsync(sites, ct);
        logger.LogInformation("ArcGIS sync: {Imported} imported, {Updated} updated from {Url}", imported, updated, layerUrl);
        return new SyncResult(imported, updated);
    }

    private async Task<List<JsonElement>> QueryGeoJsonAsync(string layerUrl, CancellationToken ct)
    {
        var url = $"{layerUrl}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        // Optional API key for a private layer: sent as a header, never in the URL (URLs end up in logs).
        if (config["ArcGis:ApiKey"] is { Length: > 0 } apiKey)
            request.Headers.Add("X-Esri-Authorization", $"Bearer {apiKey}");

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (HttpRequestException ex)
        {
            logger.LogError(ex, "ArcGIS request failed");
            throw new ArcGisSyncException("تعذّر الاتصال بخدمة ArcGIS.", 502);
        }

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
                throw new ArcGisSyncException($"خدمة ArcGIS ردّت بالحالة {(int)response.StatusCode}.", 502);

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            // ArcGIS reports errors as HTTP 200 with {"error": {"code": 498/499/400, "message": ...}}
            if (root.TryGetProperty("error", out var error))
            {
                var code = error.TryGetProperty("code", out var c) ? c.ToString() : "?";
                var msg = error.TryGetProperty("message", out var m) ? m.GetString() : "";
                throw new ArcGisSyncException(
                    code is "498" or "499"
                        ? "الطبقة خاصة وتحتاج صلاحية: أضف ArcGis:ApiKey أو اجعل الطبقة عامة (Share: Everyone)."
                        : $"خطأ من ArcGIS ({code}): {msg}", 502);
            }
            if (!root.TryGetProperty("features", out var features) || features.ValueKind != JsonValueKind.Array)
                throw new ArcGisSyncException("رد ArcGIS ليس GeoJSON FeatureCollection. تأكد أن الرابط ينتهي بـ FeatureServer/0.", 502);
            if (root.TryGetProperty("properties", out var p) && p.TryGetProperty("exceededTransferLimit", out var ex) && ex.ValueKind == JsonValueKind.True)
                logger.LogWarning("ArcGIS returned a partial page (exceededTransferLimit). Only the first page was imported.");

            return features.EnumerateArray().Select(f => f.Clone()).ToList();
        }
    }

    /// <summary>
    /// GeoJSON feature -> site. Pure (no I/O) so it is unit-tested. Field names are matched
    /// case-insensitively because ArcGIS Online may change their case when a file is published.
    /// </summary>
    public static ArcGisSite? MapFeature(JsonElement feature)
    {
        if (!feature.TryGetProperty("geometry", out var g) || g.ValueKind != JsonValueKind.Object
            || Prop(g, "type") != "Point" || !g.TryGetProperty("coordinates", out var c) || c.GetArrayLength() < 2)
            return null;
        var lon = c[0].GetDouble();
        var lat = c[1].GetDouble();
        if (lon is < -180 or > 180 || lat is < -90 or > 90) return null;

        var props = feature.TryGetProperty("properties", out var pr) && pr.ValueKind == JsonValueKind.Object ? pr : default;
        var name = Prop(props, "name");
        if (string.IsNullOrWhiteSpace(name)) return null;

        var rawType = (Prop(props, "site_type") ?? Prop(props, "amenity") ?? "").Trim().ToLowerInvariant();
        var siteType = rawType is "hospital" or "مستشفى" ? "Hospital" : "School";

        var externalId = Prop(props, "external_id");
        if (string.IsNullOrWhiteSpace(externalId))
        {
            var objectId = Prop(props, "objectid") ?? Prop(props, "fid") ??
                           (feature.TryGetProperty("id", out var id) ? id.ToString() : null);
            if (objectId is null) return null;
            externalId = $"arcgis/{objectId}";
        }
        return new ArcGisSite(externalId.Trim(), name.Trim(), siteType, lon, lat);
    }

    private static string? Prop(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object) return null;
        foreach (var p in obj.EnumerateObject())
        {
            if (!string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)) continue;
            return p.Value.ValueKind switch
            {
                JsonValueKind.String => p.Value.GetString(),
                JsonValueKind.Number => p.Value.GetRawText(),
                _ => null,
            };
        }
        return null;
    }

    /// <summary>One transaction: update existing external_ids, insert new ones.</summary>
    private async Task<(int Imported, int Updated)> UpsertAsync(List<ArcGisSite> sites, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var tx = (OracleTransaction)await conn.BeginTransactionAsync(ct);
        int imported = 0, updated = 0;

        foreach (var s in sites)
        {
            var wkt = string.Create(CultureInfo.InvariantCulture, $"POINT ({s.Lon:R} {s.Lat:R})");

            await using var update = OracleDb.Command(conn, """
                UPDATE sensitive_sites
                   SET name = :name, site_type = :site_type, source = 'ArcGIS', geom = SDO_GEOMETRY(:wkt, 4326)
                 WHERE external_id = :external_id
                """)
                .Add("name", OracleDbType.Varchar2, Truncate(s.Name, 200))
                .Add("site_type", OracleDbType.Varchar2, s.SiteType)
                .AddWkt(wkt)
                .Add("external_id", OracleDbType.Varchar2, Truncate(s.ExternalId, 100));
            update.Transaction = tx;

            if (await update.ExecuteNonQueryAsync(ct) > 0)
            {
                updated++;
                continue;
            }

            await using var insert = OracleDb.Command(conn, """
                INSERT INTO sensitive_sites (name, site_type, source, external_id, geom)
                VALUES (:name, :site_type, 'ArcGIS', :external_id, SDO_GEOMETRY(:wkt, 4326))
                """)
                .Add("name", OracleDbType.Varchar2, Truncate(s.Name, 200))
                .Add("site_type", OracleDbType.Varchar2, s.SiteType)
                .Add("external_id", OracleDbType.Varchar2, Truncate(s.ExternalId, 100))
                .AddWkt(wkt);
            insert.Transaction = tx;
            await insert.ExecuteNonQueryAsync(ct);
            imported++;
        }

        await tx.CommitAsync(ct);
        return (imported, updated);
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
