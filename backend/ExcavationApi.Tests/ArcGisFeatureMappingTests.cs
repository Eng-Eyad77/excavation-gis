using System.Text.Json;
using ExcavationApi.Services;

namespace ExcavationApi.Tests;

public class ArcGisFeatureMappingTests
{
    private static JsonElement F(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void Maps_a_feature_published_from_sensitive_sites_geojson()
    {
        var site = ArcGisSyncService.MapFeature(F("""
            {"type":"Feature","id":3,
             "properties":{"OBJECTID":3,"name":"Reef Jeddah International School","site_type":"School","external_id":"way/160123150"},
             "geometry":{"type":"Point","coordinates":[39.1855,21.5098]}}
            """));

        Assert.NotNull(site);
        Assert.Equal("way/160123150", site.ExternalId);
        Assert.Equal("School", site.SiteType);
        Assert.Equal(39.1855, site.Lon);
        Assert.Equal(21.5098, site.Lat);
    }

    [Fact]
    public void Field_names_are_case_insensitive_and_hospital_is_recognised()
    {
        var site = ArcGisSyncService.MapFeature(F("""
            {"type":"Feature","properties":{"NAME":"مستشفى","SITE_TYPE":"hospital","EXTERNAL_ID":"node/1"},
             "geometry":{"type":"Point","coordinates":[39.18,21.51]}}
            """));

        Assert.Equal("Hospital", site!.SiteType);
    }

    [Fact]
    public void Without_external_id_the_object_id_is_used()
    {
        var site = ArcGisSyncService.MapFeature(F("""
            {"type":"Feature","properties":{"OBJECTID":42,"name":"New school"},
             "geometry":{"type":"Point","coordinates":[39.18,21.51]}}
            """));

        Assert.Equal("arcgis/42", site!.ExternalId);
    }

    [Theory]
    [InlineData("""{"type":"Feature","properties":{"name":"x"},"geometry":{"type":"LineString","coordinates":[[39,21],[39.1,21.1]]}}""")]
    [InlineData("""{"type":"Feature","properties":{"name":"x"},"geometry":null}""")]
    [InlineData("""{"type":"Feature","properties":{"site_type":"School","external_id":"a"},"geometry":{"type":"Point","coordinates":[39,21]}}""")]
    public void Features_without_a_point_or_a_name_are_skipped(string json)
    {
        Assert.Null(ArcGisSyncService.MapFeature(F(json)));
    }
}
