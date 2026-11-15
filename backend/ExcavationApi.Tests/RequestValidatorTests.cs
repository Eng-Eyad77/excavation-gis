using ExcavationApi.Domain;

namespace ExcavationApi.Tests;

public class RequestValidatorTests
{
    private static readonly DateOnly Today = DateOnly.Parse("2026-11-14");

    private static ExcavationInput Valid(
        IReadOnlyList<IReadOnlyList<double[]>>? paths = null,
        double width = 1.5, string start = "2026-12-01", string end = "2026-12-15") =>
        new(paths ?? [[[39.1861229, 21.5148847], [39.1874761, 21.502387]]],
            width, DateOnly.Parse(start), DateOnly.Parse(end), "Fiber cable", null);

    [Fact]
    public void Valid_request_has_no_errors()
    {
        Assert.Empty(RequestValidator.Validate(Valid(), Today, isNewRequest: true));
    }

    [Fact]
    public void One_point_path_is_rejected()
    {
        var errors = RequestValidator.Validate(Valid(paths: [[[39.18, 21.51]]]), Today, true);
        Assert.Contains(errors, e => e.Contains("نقطتين"));
    }

    [Fact]
    public void Empty_paths_are_rejected()
    {
        var errors = RequestValidator.Validate(Valid(paths: []), Today, true);
        Assert.Single(errors);
    }

    [Fact]
    public void End_before_start_is_rejected()
    {
        var errors = RequestValidator.Validate(Valid(start: "2026-12-15", end: "2026-12-01"), Today, true);
        Assert.Contains(errors, e => e.Contains("تاريخ النهاية"));
    }

    [Fact]
    public void Utm_metres_typed_as_degrees_are_detected()
    {
        // First two demo-route vertices in UTM zone 37N (metres), pasted into the lon/lat fields
        var errors = RequestValidator.Validate(Valid(paths: [[[519276.44, 2379144.56], [519280.40, 2379093.06]]]), Today, true);
        Assert.Contains(errors, e => e.Contains("UTM"));
    }

    [Fact]
    public void Swapped_lat_lon_is_detected()
    {
        var errors = RequestValidator.Validate(Valid(paths: [[[21.5148847, 39.1861229], [21.502387, 39.1874761]]]), Today, true);
        Assert.Contains(errors, e => e.Contains("معكوسان"));
    }

    [Theory]
    [InlineData(0.1)]
    [InlineData(12)]
    public void Width_out_of_range_is_rejected(double width)
    {
        var errors = RequestValidator.Validate(Valid(width: width), Today, true);
        Assert.Contains(errors, e => e.Contains("عرض"));
    }

    [Fact]
    public void Duration_over_180_days_is_rejected()
    {
        var errors = RequestValidator.Validate(Valid(start: "2026-12-01", end: "2027-06-30"), Today, true);
        Assert.Contains(errors, e => e.Contains("180"));
    }

    [Fact]
    public void Past_start_date_is_rejected_only_for_new_requests()
    {
        var past = Valid(start: "2026-11-01", end: "2026-11-20");
        Assert.Contains(RequestValidator.Validate(past, Today, isNewRequest: true), e => e.Contains("الماضي"));
        Assert.Empty(RequestValidator.Validate(past, Today, isNewRequest: false));
    }
}
