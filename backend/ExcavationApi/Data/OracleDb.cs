using System.Text.Json;
using Oracle.ManagedDataAccess.Client;

namespace ExcavationApi.Data;

/// <summary>
/// Small ADO.NET helper: opens pooled connections and creates commands with
/// BindByName = true (ODP.NET binds by POSITION by default, which silently swaps
/// values when a query uses the same parameter twice or in a different order).
/// </summary>
public sealed class OracleDb(IConfiguration configuration)
{
    private readonly string _connectionString =
        configuration.GetConnectionString("Oracle") is { Length: > 0 } cs && !cs.StartsWith("SET_WITH")
            ? cs
            : throw new InvalidOperationException(
                "ConnectionStrings:Oracle is not configured. Run database\\setup-db.ps1 or set it with dotnet user-secrets.");

    public async Task<OracleConnection> OpenAsync(CancellationToken ct = default)
    {
        var connection = new OracleConnection(_connectionString);
        await connection.OpenAsync(ct);
        return connection;
    }

    public static OracleCommand Command(OracleConnection connection, string sql)
    {
        var cmd = connection.CreateCommand();
        cmd.BindByName = true;
        cmd.CommandText = sql;
        return cmd;
    }
}

public static class OracleExtensions
{
    public static OracleCommand Add(this OracleCommand cmd, string name, OracleDbType type, object? value)
    {
        cmd.Parameters.Add(name, type).Value = value ?? DBNull.Value;
        return cmd;
    }

    /// <summary>WKT goes in as a CLOB so long routes are not limited to 4000 bytes.</summary>
    public static OracleCommand AddWkt(this OracleCommand cmd, string wkt) => cmd.Add("wkt", OracleDbType.Clob, wkt);

    public static OracleCommand AddDate(this OracleCommand cmd, string name, DateOnly date) =>
        cmd.Add(name, OracleDbType.Date, date.ToDateTime(TimeOnly.MinValue));

    public static string? Str(this OracleDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        return r.IsDBNull(i) ? null : r.GetString(i);
    }

    public static int Int(this OracleDataReader r, string col) => Convert.ToInt32(r.GetDecimal(r.GetOrdinal(col)));

    /// <summary>Numbers are ROUNDed in SQL: an unrounded Oracle NUMBER can exceed .NET decimal precision.</summary>
    public static double? Dbl(this OracleDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        return r.IsDBNull(i) ? null : (double)r.GetDecimal(i);
    }

    public static DateOnly Date(this OracleDataReader r, string col) => DateOnly.FromDateTime(r.GetDateTime(r.GetOrdinal(col)));

    public static DateTime? DateTimeOrNull(this OracleDataReader r, string col)
    {
        var i = r.GetOrdinal(col);
        return r.IsDBNull(i) ? null : r.GetDateTime(i);
    }

    /// <summary>SDO_UTIL.TO_GEOJSON returns a CLOB; parse it into a JSON element for the response.</summary>
    public static JsonElement? GeoJson(this OracleDataReader r, string col)
    {
        var s = r.Str(col);
        if (string.IsNullOrWhiteSpace(s)) return null;
        using var doc = JsonDocument.Parse(s);
        return doc.RootElement.Clone();
    }
}
