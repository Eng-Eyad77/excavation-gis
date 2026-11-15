using ExcavationApi.Services;

namespace ExcavationApi.Data;

/// <summary>
/// Seeds the demo users at startup (Development only) with PBKDF2-hashed passwords.
/// Users are not in 02_seed.sql because SQL cannot produce our password hash format.
/// DEV ONLY: these demo credentials are documented in the README.
/// </summary>
public static class DbSeeder
{
    private static readonly (string Username, string Password, string Role, string? AgencyCode)[] DemoUsers =
    [
        ("stc", "Stc@12345", "Applicant", "STC"),
        ("nwc", "Nwc@12345", "Applicant", "NWC"),
        ("reviewer", "Review@12345", "Reviewer", null),
    ];

    public static async Task SeedAsync(IServiceProvider services, ILogger logger)
    {
        try
        {
            using var scope = services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserRepository>();
            foreach (var u in DemoUsers)
            {
                if (await users.InsertIfMissingAsync(u.Username, PasswordHasher.Hash(u.Password), u.Role, u.AgencyCode, CancellationToken.None))
                    logger.LogInformation("Seeded demo user {Username} ({Role})", u.Username, u.Role);
            }
        }
        catch (Exception ex)
        {
            // Keep the API (and Swagger) up even if Oracle is not reachable yet.
            logger.LogError(ex, "Seeding demo users failed. Is Oracle running and ConnectionStrings:Oracle set?");
        }
    }
}
