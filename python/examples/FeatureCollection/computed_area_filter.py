#!/usr/bin/env python
"""Computed area filter example.

Find US counties smaller than 3k square kilometers in area.
"""

import ee
import ee.mapclient

ee.Initialize()
ee.mapclient.centerMap(-119.7, 38.26, 7)

counties = ee.FeatureCollection(
    'ft:1pjtcfSKIbYbj4wRcBjc0Bb6NB-sQRI-L2nIzHiU')
counties_with_area = counties.map(lambda f: f.set({'area': f.area()}))
small_counties = counties_with_area.filterMetadata('area', 'less_than', 3e9)

ee.mapclient.addToMap(small_counties, {'color': '900000'})
