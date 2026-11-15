using System.Security.Cryptography;

namespace ExcavationApi.Services;

/// <summary>
/// PBKDF2 (SHA-256, 100,000 iterations, random 16-byte salt).
/// Stored format: PBKDF2$SHA256$100000$&lt;salt base64&gt;$&lt;hash base64&gt;
/// </summary>
public static class PasswordHasher
{
    private const int Iterations = 100_000;
    private const int SaltSize = 16;
    private const int HashSize = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashSize);
        return $"PBKDF2$SHA256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        var parts = stored.Split('$');
        if (parts.Length != 5 || parts[0] != "PBKDF2" || parts[1] != "SHA256" || !int.TryParse(parts[2], out var iterations))
            return false;

        var salt = Convert.FromBase64String(parts[3]);
        var expected = Convert.FromBase64String(parts[4]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        // Constant-time comparison: no timing hint about how many bytes matched
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}
