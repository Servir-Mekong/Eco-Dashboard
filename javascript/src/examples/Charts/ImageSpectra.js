// Plot band values at points in an image.
var landsat8Toa = ee.ImageCollection('LANDSAT/LC8_L1T_32DAY_TOA');

var COLOR = {
  PARK: 'ff0000',
  FARM: '0000ff',
  URBAN: '00ff00'
};

// Three known locations.
var park = ee.Feature(
    ee.Geometry.Point(-99.25260, 19.32235), {'label': 'park'});
var farm = ee.Feature(
    ee.Geometry.Point(-99.08992, 19.27868), {'label': 'farm'});
var urban = ee.Feature(
    ee.Geometry.Point(-99.21135, 19.31860), {'label': 'urban'});

var mexicoPoints = ee.FeatureCollection([park, farm, urban]);
var mexicoImage = ee.Image(landsat8Toa.first()).clip(mexicoPoints.union());

// Select bands B1 to B7.
mexicoImage = mexicoImage.select(['B[1-7]']);

var bandChart = Chart.image.regions(
    mexicoImage, mexicoPoints, null, 30, 'label');
bandChart = bandChart.setChartType('LineChart');
bandChart = bandChart.setOptions({
  title: 'Landsat 8 TOA band values at three points near Mexico City',
  hAxis: {
    title: 'Band'
  },
  vAxis: {
    title: 'Reflectance'
  },
  lineWidth: 1,
  pointSize: 4,
  series: {
    0: {color: COLOR.PARK},
    1: {color: COLOR.FARM},
    2: {color: COLOR.URBAN}
  }
});

// From: http://landsat.usgs.gov/band_designations_landsat_satellites.php
var wavelengths = [.44, .48, .56, .65, .86, 1.61, 2.2];

var spectraChart = Chart.image.regions(
    mexicoImage, mexicoPoints, null, 30, 'label', wavelengths);
spectraChart = spectraChart.setChartType('LineChart');
spectraChart = spectraChart.setOptions({
  title: 'Landsat 8 TOA spectra at three points near Mexico City',
  hAxis: {
    title: 'Wavelength (micrometers)'
  },
  vAxis: {
    title: 'Reflectance'
  },
  lineWidth: 1,
  pointSize: 4,
  series: {
    0: {color: COLOR.PARK},
    1: {color: COLOR.FARM},
    2: {color: COLOR.URBAN}
  }
});

print(bandChart);
print(spectraChart);

Map.addLayer(park, {color: COLOR.PARK});
Map.addLayer(farm, {color: COLOR.FARM});
Map.addLayer(urban, {color: COLOR.URBAN});
Map.setCenter(-99.25260, 19.32235, 11);
