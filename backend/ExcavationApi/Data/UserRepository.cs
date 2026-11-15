using Oracle.ManagedDataAccess.Client;

namespace ExcavationApi.Data;

public sealed record AppUser(int Id, string Username, string PasswordHash, string Role, int? AgencyId, string? AgencyCode, string? AgencyName);

public sealed class UserRepository(OracleDb db)
{
    public async Task<AppUser?> FindByUsernameAsync(string username, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = OracleDb.Command(conn, """
            SELECT u.id, u.username, u.password_hash, u.role, u.agency_id, a.code AS agency_code, a.name_ar AS agency_name
            FROM app_users u LEFT JOIN agencies a ON a.id = u.agency_id
            WHERE LOWER(u.username) = LOWER(:username)
            """).Add("username", OracleDbType.Varchar2, username);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        var agencyOrdinal = r.GetOrdinal("agency_id");
        return new AppUser(r.Int("id"), r.Str("username")!, r.Str("password_hash")!, r.Str("role")!,
            r.IsDBNull(agencyOrdinal) ? null : r.Int("agency_id"), r.Str("agency_code"), r.Str("agency_name"));
    }

    /// <summary>Inserts the user if the username is not taken yet. Returns true when inserted.</summary>
    public async Task<bool> InsertIfMissingAsync(string username, string passwordHash, string role, string? agencyCode, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = OracleDb.Command(conn, """
            INSERT INTO app_users (username, password_hash, role, agency_id)
            SELECT :username, :hash, :role, (SELECT id FROM agencies WHERE code = :agency_code)
            FROM dual
            WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE LOWER(username) = LOWER(:username))
            """)
            .Add("username", OracleDbType.Varchar2, username)
            .Add("hash", OracleDbType.Varchar2, passwordHash)
            .Add("role", OracleDbType.Varchar2, role)
            .Add("agency_code", OracleDbType.Varchar2, agencyCode);
        return await cmd.ExecuteNonQueryAsync(ct) == 1;
    }
}
