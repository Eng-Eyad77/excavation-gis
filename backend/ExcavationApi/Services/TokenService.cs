using System.Security.Claims;
using System.Text;
using ExcavationApi.Data;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace ExcavationApi.Services;

public sealed class JwtOptions
{
    public string Issuer { get; set; } = "";
    public string Audience { get; set; } = "";
    public string Key { get; set; } = "";
    public int ExpiresMinutes { get; set; } = 480;

    public SymmetricSecurityKey SigningKey()
    {
        if (string.IsNullOrWhiteSpace(Key) || Key.StartsWith("SET_WITH") || Encoding.UTF8.GetByteCount(Key) < 32)
            throw new InvalidOperationException("Jwt:Key is missing or shorter than 32 bytes. Set it with dotnet user-secrets.");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Key));
    }
}

/// <summary>Custom claim names used across the API.</summary>
public static class AppClaims
{
    public const string UserId = "sub";
    public const string Name = "name";
    public const string Role = "role";
    public const string AgencyId = "agency_id";
    public const string AgencyName = "agency_name";
}

public static class Roles
{
    public const string Applicant = "Applicant";
    public const string Reviewer = "Reviewer";
}

public sealed class TokenService(JwtOptions options)
{
    public string Create(AppUser user)
    {
        var claims = new List<Claim>
        {
            new(AppClaims.UserId, user.Id.ToString()),
            new(AppClaims.Name, user.Username),
            new(AppClaims.Role, user.Role),
        };
        if (user.AgencyId is int agencyId) claims.Add(new Claim(AppClaims.AgencyId, agencyId.ToString()));
        if (user.AgencyName is { } agencyName) claims.Add(new Claim(AppClaims.AgencyName, agencyName));

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = options.Issuer,
            Audience = options.Audience,
            Subject = new ClaimsIdentity(claims),
            Expires = DateTime.UtcNow.AddMinutes(options.ExpiresMinutes),
            SigningCredentials = new SigningCredentials(options.SigningKey(), SecurityAlgorithms.HmacSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }
}

public static class ClaimsPrincipalExtensions
{
    public static int UserId(this ClaimsPrincipal user) => int.Parse(user.FindFirstValue(AppClaims.UserId)!);

    public static int? AgencyId(this ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue(AppClaims.AgencyId), out var id) ? id : null;

    public static string? AgencyName(this ClaimsPrincipal user) => user.FindFirstValue(AppClaims.AgencyName);
}
