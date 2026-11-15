using System.Globalization;
using System.Text;

namespace ExcavationApi.Domain;

/// <summary>
/// Builds OGC Well-Known Text for Oracle's SDO_GEOMETRY(wkt, 4326) constructor.
/// Coordinates are "lon lat" (x y). Always InvariantCulture: on an Arabic or French
/// Windows locale, 39.18 would otherwise become "39,18" and break the WKT.
/// </summary>
public static class WktBuilder
{
    public static string Build(IReadOnlyList<IReadOnlyList<double[]>> paths)
    {
        if (paths is null || paths.Count == 0) throw new ArgumentException("At least one path is required.", nameof(paths));

        var sb = new StringBuilder();
        if (paths.Count == 1)
        {
            sb.Append("LINESTRING ");
            AppendPath(sb, paths[0]);
        }
        else
        {
            sb.Append("MULTILINESTRING (");
            for (var i = 0; i < paths.Count; i++)
            {
                if (i > 0) sb.Append(", ");
                AppendPath(sb, paths[i]);
            }
            sb.Append(')');
        }
        return sb.ToString();
    }

    private static void AppendPath(StringBuilder sb, IReadOnlyList<double[]> path)
    {
        sb.Append('(');
        for (var i = 0; i < path.Count; i++)
        {
            if (i > 0) sb.Append(", ");
            sb.Append(path[i][0].ToString("R", CultureInfo.InvariantCulture))
              .Append(' ')
              .Append(path[i][1].ToString("R", CultureInfo.InvariantCulture));
        }
        sb.Append(')');
    }
}
