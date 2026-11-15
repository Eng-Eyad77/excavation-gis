using System.Globalization;
using ExcavationApi.Domain;

namespace ExcavationApi.Tests;

public class WktBuilderTests
{
    [Fact]
    public void Single_path_becomes_a_LINESTRING_in_lon_lat_order()
    {
        var wkt = WktBuilder.Build([[[39.1861229, 21.5148847], [39.1874761, 21.502387]]]);
        Assert.Equal("LINESTRING (39.1861229 21.5148847, 39.1874761 21.502387)", wkt);
    }

    [Fact]
    public void Several_paths_become_a_MULTILINESTRING()
    {
        var wkt = WktBuilder.Build([
            [[39.1, 21.5], [39.2, 21.6]],
            [[39.3, 21.7], [39.4, 21.8]],
        ]);
        Assert.Equal("MULTILINESTRING ((39.1 21.5, 39.2 21.6), (39.3 21.7, 39.4 21.8))", wkt);
    }

    [Theory]
    [InlineData("ar-SA")]
    [InlineData("fr-FR")]   // uses a comma as decimal separator
    public void Always_uses_a_dot_decimal_separator_whatever_the_culture(string culture)
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo(culture);
            var wkt = WktBuilder.Build([[[39.18, 21.51], [39.19, 21.52]]]);
            Assert.Equal("LINESTRING (39.18 21.51, 39.19 21.52)", wkt);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }
}
