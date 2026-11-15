using ExcavationApi.Contracts;
using ExcavationApi.Data;
using ExcavationApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ExcavationApi.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController(UserRepository users, TokenService tokens) : ControllerBase
{
    /// <summary>Log in and receive a JWT (paste it into Swagger's Authorize button).</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [ProducesResponseType<LoginResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Login(LoginRequest request, CancellationToken ct)
    {
        var user = await users.FindByUsernameAsync(request.Username, ct);
        if (user is null || !PasswordHasher.Verify(request.Password, user.PasswordHash))
            return Problem(title: "اسم المستخدم أو كلمة المرور غير صحيحة.", statusCode: StatusCodes.Status401Unauthorized);

        return Ok(new LoginResponse(tokens.Create(user), user.Username, user.Role, user.AgencyId, user.AgencyName));
    }
}

[ApiController]
[Route("api/agencies")]
[Authorize]
public sealed class AgenciesController(LayerRepository layers) : ControllerBase
{
    [HttpGet]
    public Task<List<AgencyDto>> Get(CancellationToken ct) => layers.AgenciesAsync(ct);
}
