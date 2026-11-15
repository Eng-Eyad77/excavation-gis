using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace ExcavationApi.Infrastructure;

/// <summary>
/// Adds a "Bearer" (JWT) security scheme to the OpenAPI document, so Swagger UI shows
/// the Authorize button and sends "Authorization: Bearer &lt;token&gt;" on every call.
/// </summary>
public sealed class BearerSecuritySchemeTransformer : IOpenApiDocumentTransformer
{
    public Task TransformAsync(OpenApiDocument document, OpenApiDocumentTransformerContext context, CancellationToken cancellationToken)
    {
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
        document.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT",
            In = ParameterLocation.Header,
            Description = "Paste the token from POST /api/auth/login (without the word Bearer).",
        };

        document.Security ??= [];
        document.Security.Add(new OpenApiSecurityRequirement
        {
            [new OpenApiSecuritySchemeReference("Bearer", document)] = [],
        });

        document.Info = new OpenApiInfo
        {
            Title = "Excavation Coordination GIS API",
            Version = "v1",
            Description = "Spatio-temporal conflict detection on Oracle Spatial. Log in with POST /api/auth/login, then click Authorize.",
        };
        return Task.CompletedTask;
    }
}
