using ExcavationApi.Data;
using ExcavationApi.Infrastructure;
using ExcavationApi.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------- configuration
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
builder.Services.AddSingleton(jwt);

// ---------------------------------------------------------------- data + services (plain ADO.NET, no ORM)
builder.Services.AddSingleton<OracleDb>();
builder.Services.AddScoped<ExcavationRepository>();
builder.Services.AddScoped<LayerRepository>();
builder.Services.AddScoped<UserRepository>();
builder.Services.AddScoped<AnalysisService>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddHttpClient<ArcGisSyncService>(c => c.Timeout = TimeSpan.FromSeconds(30));   // ArcGIS REST API

// ---------------------------------------------------------------- authentication: JWT bearer
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;   // keep our short claim names: sub, name, role, agency_id
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = jwt.SigningKey(),   // fails fast at startup if Jwt:Key is missing
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
            NameClaimType = AppClaims.Name,
            RoleClaimType = AppClaims.Role,       // [Authorize(Roles = "Reviewer")] reads this claim
        };
    });
builder.Services.AddAuthorization();

// ---------------------------------------------------------------- CORS: only the Angular dev server
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:4200")
    .AllowAnyHeader()
    .AllowAnyMethod()));

// ---------------------------------------------------------------- errors: RFC 7807 ProblemDetails
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();

builder.Services.AddControllers();
builder.Services.AddOpenApi(o => o.AddDocumentTransformer<BearerSecuritySchemeTransformer>());

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();   // empty 401/403/404 responses also become ProblemDetails

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();                                  // /openapi/v1.json
    app.UseSwaggerUI(o =>
    {
        o.SwaggerEndpoint("/openapi/v1.json", "Excavation GIS API v1");
        o.RoutePrefix = "swagger";                     // http://localhost:5106/swagger
        o.EnablePersistAuthorization();
    });
    app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();

    // Demo users (stc, nwc, reviewer): created only in Development
    await DbSeeder.SeedAsync(app.Services, app.Logger);
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
