/**
 * @fileoverview An object representing EE Geometries.
 */

goog.provide('ee.Geometry');
goog.provide('ee.Geometry.LineString');
goog.provide('ee.Geometry.LinearRing');
goog.provide('ee.Geometry.MultiLineString');
goog.provide('ee.Geometry.MultiPoint');
goog.provide('ee.Geometry.MultiPolygon');
goog.provide('ee.Geometry.Point');
goog.provide('ee.Geometry.Polygon');
goog.provide('ee.Geometry.Rectangle');

goog.require('ee.ApiFunction');
goog.require('ee.ComputedObject');
goog.require('ee.Serializer');
goog.require('ee.Types');
goog.require('ee.arguments');
goog.require('goog.array');
goog.require('goog.json.Serializer');
goog.require('goog.object');

goog.forwardDeclare('ee.ErrorMargin');
goog.forwardDeclare('ee.Projection');



/**
 * Creates a geometry.
 * @param {Object} geoJson The GeoJSON object describing the geometry or
 *     a ComputedObject to be reinterpreted as a Geometry. Supports
 *     CRS specifications as per the GeoJSON spec, but only allows named
 *     (rather than "linked" CRSs). If this includes a 'geodesic' field,
 *     and opt_geodesic is not specified, it will be used as opt_geodesic.
 * @param {ee.Projection=} opt_proj An optional projection specification, either
 *     as a CRS ID code or as a WKT string. If specified, overrides any CRS
 *     found in the geoJson parameter. If unspecified and the geoJson does not
 *     declare a CRS, defaults to "EPSG:4326" (x=longitude, y=latitude).
 * @param {boolean=} opt_geodesic Whether line segments should be interpreted
 *     as spherical geodesics. If false, indicates that line segments should
 *     be interpreted as planar lines in the specified CRS. If absent, defaults
 *     to true if the CRS is geographic (including the default EPSG:4326),
 *     or to false if the CRS is projected.
 * @param {boolean=} opt_evenOdd If true, polygon interiors will be determined
 *     by the even/odd rule, where a point is inside if it crosses an odd number
 *     of edges to reach a point at infinity. Otherwise polygons use the left-
 *     inside rule, where interiors are on the left side of the shell's edges
 *     when walking the vertices in the given order. If unspecified, defaults to
 *     true.
 * @constructor
 * @extends {ee.ComputedObject}
 * @export
 */
ee.Geometry = function(geoJson, opt_proj, opt_geodesic, opt_evenOdd) {
  if (!(this instanceof ee.Geometry)) {
    return ee.ComputedObject.construct(ee.Geometry, arguments);
  }

  // Note: evenOdd is a parameter name and may be a key in the
  // first argument, the geoJson object. This means ee.arguments.extract()
  // cannot reliably differentiate:
  //
  //       1) ee.Geometry(myGeoJsonObject)
  //  from 2) ee.Geometry({geoJson: myGeoJsonObject})
  //
  // However, we know that the geoJson object MUST contain the "type" key,
  // which is not an expected param name. If we see this key in the first
  // argument, we know the arguments were passed in sequence. If not, we
  // assume the user intended to pass a named argument dictionary and use
  // ee.arguments.extract() to validate and extract the keys.
  if (!('type' in geoJson)) {
    var args = ee.arguments.extract(ee.Geometry, arguments);
    geoJson = args['geoJson'];
    opt_proj = args['proj'];
    opt_geodesic = args['geodesic'];
    opt_evenOdd = args['evenOdd'];
  }

  ee.Geometry.initialize();

  var computed = geoJson instanceof ee.ComputedObject &&
                 !(geoJson instanceof ee.Geometry && geoJson.type_);
  var options = (goog.isDefAndNotNull(opt_proj) ||
                 goog.isDefAndNotNull(opt_geodesic) ||
                 goog.isDefAndNotNull(opt_evenOdd));
  if (computed) {
    if (options) {
      throw new Error(
          'Setting the CRS, geodesic, or evenOdd flag on a computed Geometry ' +
          'is not suported.  Use Geometry.transform().');
    } else {
      goog.base(this, geoJson.func, geoJson.args, geoJson.varName);
      return;
    }
  }

  // Below here, we're working with a GeoJSON literal.
  if (geoJson instanceof ee.Geometry) {
    geoJson = /** @type {Object} */(geoJson.encode());
  }

  if (!ee.Geometry.isValidGeometry_(geoJson)) {
    throw Error('Invalid GeoJSON geometry: ' + JSON.stringify(geoJson));
  }

  goog.base(this, null, null);

  /**
   * The type of the geometry.
   * @type {string}
   * @private
   */
  this.type_ = geoJson['type'];

  /**
   * The coordinates of the geometry, up to 4 nested levels with numbers at
   * the last level. Null iff type is GeometryCollection.
   * @type {Array?}
   * @private
   */
  this.coordinates_ = geoJson['coordinates'] || null;

  /**
   * The subgeometries, non-null iff type is GeometryCollection.
   * @type {Array?}
   * @private
   */
  this.geometries_ = geoJson['geometries'] || null;

  /**
   * The projection of the geometry.
   * @type {String|undefined}
   * @private
   */
  this.proj_;
  if (goog.isDefAndNotNull(opt_proj)) {
    this.proj_ = opt_proj;
  } else if ('crs' in geoJson) {
    if (goog.isObject(geoJson['crs']) &&
        geoJson['crs']['type'] == 'name' &&
        goog.isObject(geoJson['crs']['properties']) &&
        goog.isString(geoJson['crs']['properties']['name'])) {
      this.proj_ = geoJson['crs']['properties']['name'];
    } else {
      throw Error('Invalid CRS declaration in GeoJSON: ' +
                  (new goog.json.Serializer()).serialize(geoJson['crs']));
    }
  }

  /**
   * Whether the geometry has spherical geodesic edges.
   * @type {boolean|undefined}
   * @private
   */
  this.geodesic_ = opt_geodesic;
  if (!goog.isDef(this.geodesic_) && 'geodesic' in geoJson) {
    this.geodesic_ = Boolean(geoJson['geodesic']);
  }

  /**
   * Whether polygon interiors are based on the even/odd rule. If false,
   * the left-inside rule is used. If unspecified, defaults to true.
   * @type {boolean|undefined}
   * @private
   */
  this.evenOdd_ = opt_evenOdd;
  if (!goog.isDef(this.evenOdd_) && 'evenOdd' in geoJson) {
    this.evenOdd_ = Boolean(geoJson['evenOdd']);
  }
};
goog.inherits(ee.Geometry, ee.ComputedObject);


/**
 * Whether the class has been initialized with API functions.
 * @type {boolean}
 * @private
 */
ee.Geometry.initialized_ = false;


/**
 * Imports API functions to this class.
 */
ee.Geometry.initialize = function() {
  if (!ee.Geometry.initialized_) {
    ee.ApiFunction.importApi(ee.Geometry, 'Geometry', 'Geometry');
    ee.Geometry.initialized_ = true;
  }
};


/**
 * Removes imported API functions from this class.
 */
ee.Geometry.reset = function() {
  ee.ApiFunction.clearApi(ee.Geometry);
  ee.Geometry.initialized_ = false;
};



////////////////////////////////////////////////////////////////////////////////
//                           Subclass constructors.                           //
////////////////////////////////////////////////////////////////////////////////



/**
 * Constructs an ee.Geometry describing a point.
 *
 * For convenience, varargs may be used when all arguments are numbers. This
 * allows creating EPSG:4326 points, e.g. ee.Geometry.Point(lng, lat).
 *
 * @param {!Array<number>} coords A list of two [x,y] coordinates in the given
 *     projection.
 * @param {ee.Projection=} opt_proj The projection of this geometry, or
 *     EPSG:4326 if unspecified.
 * @constructor
 * @extends {ee.Geometry}
 * @export
 */
ee.Geometry.Point = function(coords, opt_proj) {
  if (!(this instanceof ee.Geometry.Point)) {
    return ee.Geometry.createInstance_(ee.Geometry.Point, arguments);
  }
  var init = ee.Geometry.construct_(ee.Geometry.Point, 'Point', 1, arguments);
  if (!(init instanceof ee.ComputedObject)) {
    var xy = init['coordinates'];
    if (!goog.isArray(xy) || xy.length != 2) {
      throw Error('The Geometry.Point constructor requires 2 coordinates.');
    }
  }
  goog.base(this, init);
};
goog.inherits(ee.Geometry.Point, ee.Geometry);



/**
 * Constructs an ee.Geometry describing a MultiPoint.
 *
 * For convenience, varargs may be used when all arguments are numbers. This
 * allows creating EPSG:4326 MultiPoints given an even number of arguments,
 * e.g. ee.Geometry.MultiPoint(aLng, aLat, bLng, bLat, ...).
 *
 * @param {!Array<!Array<number>>|
 *          Array<!ee.Geometry>|
 *          Array<number>} coords
 *     A list of points, each in the GeoJSON 'coordinates' format of a Point, or
 *     a list of the x,y coordinates in the given projection, or an ee.Geometry
 *     describing a point.
 * @param {ee.Projection=} opt_proj The projection of this geometry. If
 *     unspecified, the default is the projection of the input ee.Geometry, or
 *     EPSG:4326 if there are no ee.Geometry inputs.
 * @constructor
 * @extends {ee.Geometry}
 * @export
 */
ee.Geometry.MultiPoint = function(coords, opt_proj) {
  if (!(this instanceof ee.Geometry.MultiPoint)) {
    return ee.Geometry.createInstance_(ee.Geometry.MultiPoint, arguments);
  }
  goog.base(this, ee.Geometry.construct_(
      ee.Geometry.MultiPoint, 'MultiPoint', 2, arguments));
};
goog.inherits(ee.Geometry.MultiPoint, ee.Geometry);



/**
 * Constructs an ee.Geometry describing a rectangular polygon.
 *
 * For convenience, varargs may be used when all arguments are numbers. This
 * allows creating EPSG:4326 Polygons given exactly four coordinates,
 * e.g. ee.Geometry.Rectangle(minLng, minLat, maxLng, maxLat).
 *
 * @param {!Array<!Array<number>>|
 *          Array<!ee.Geometry>|
 *          Array<number>} coords
 *     The minimum and maximum corners of the rectangle, as a list of two points
 *     each in the format of GeoJSON 'Point' coordinates, or a list of two
 *     ee.Geometry describing a point, or a list of four numbers in the order
 *     xMin, yMin, xMax, yMax.
 * @param {ee.Projection=} opt_proj The projection of this geometry. If
 *     unspecified, the default is the projection of the input ee.Geometry, or
 *     EPSG:4326 if there are no ee.Geometry inputs.
 * @param {boolean=} opt_geodesic If false, edges are straight in the
 *     projection. If true, edges are curved to follow the shortest path on the
 *     surface of the Earth. The default is the geodesic state of the inputs, or
 *     true if the inputs are numbers.
 * @param {ee.ErrorMargin=} opt_maxError Max error when input geometry must be
 *     reprojected to an explicitly requested result projection or geodesic
 *     state.
 * @param {boolean=} opt_evenOdd If true, polygon interiors will be determined
 *     by the even/odd rule, where a point is inside if it crosses an odd number
 *     of edges to reach a point at infinity. Otherwise polygons use the left-
 *     inside rule, where interiors are on the left side of the shell's edges
 *     when walking the vertices in the given order. If unspecified, defaults to
 *     true.
 * @constructor
 * @extends {ee.Geometry}
 * @export
 */
ee.Geometry.Rectangle = function(
    coords, opt_proj, opt_geodesic, opt_maxError, opt_evenOdd) {
  if (!(this instanceof ee.Geometry.Rectangle)) {
    return ee.Geometry.createInstance_(ee.Geometry.Rectangle, arguments);
  }
  var init = ee.Geometry.construct_(
      ee.Geometry.Rectangle, 'Rectangle', 2, arguments);
  if (!(init instanceof ee.ComputedObject)) {
    // GeoJSON does not have a 'Rectangle' type, so expand it into a Polygon.
    var xy = init['coordinates'];
    if (xy.length != 2) {
      throw Error('The Geometry.Rectangle constructor requires 2 points or 4 ' +
          'coordinates.');
    }
    var x1 = xy[0][0];
    var y1 = xy[0][1];
    var x2 = xy[1][0];
    var y2 = xy[1][1];
    init['coordinates'] = [[[x1, y2], [x1, y1], [x2, y1], [x2, y2]]];
    init['type'] = 'Polygon';
  }
  goog.base(this, init);
};
goog.inherits(ee.Geometry.Rectangle, ee.Geometry);



/**
 * Constructs an ee.Geometry describing a LineString.
 *
 * For convenience, varargs may be used when all arguments are numbers. This
 * allows creating geodesic EPSG:4326 LineStrings given an even number of
 * arguments, e.g. ee.Geometry.LineString(aLng, aLat, bLng, bLat, ...).
 *
 * @param {!Array<!Array<number>>|
 *          Array<!ee.Geometry>|
 *          Array<number>} coords
 *     A list of at least two points.  May be a list of coordinates in the
 *     GeoJSON 'LineString' format, a list of at least two ee.Geometry
 *     describing a point, or a list of at least four numbers defining the [x,y]
 *     coordinates of at least two points.
 * @param {ee.Projection=} opt_proj The projection of this geometry. If
 *     unspecified, the default is the projection of the input ee.Geometry, or
 *     EPSG:4326 if there are no ee.Geometry inputs.
 * @param {boolean=} opt_geodesic If false, edges are straight in the
 *     projection. If true, edges are curved to follow the shortest path on the
 *     surface of the Earth. The default is the geodesic state of the inputs, or
 *     true if the inputs are numbers.
 * @param {ee.ErrorMargin=} opt_maxError Max error when input geometry must be
 *     reprojected to an explicitly requested result projection or geodesic
 *     state.
 * @constructor
 * @extends {ee.Geometry}
 * @export
 */
ee.Geometry.LineString = function(
    coords, opt_proj, opt_geodesic, opt_maxError) {
  if (!(this instanceof ee.Geometry.LineString)) {
    return ee.Geometry.createInstance_(ee.Geometry.LineString, arguments);
  }
  goog.base(this, ee.Geometry.construct_(
      ee.Geometry.LineString, 'LineString', 2, arguments));
};
goog.inherits(ee.Geometry.LineString, ee.Geometry);



/**
 * Constructs an ee.Geometry describing a LinearRing. If the last point is not
 * equal to the first, a duplicate of the first point will be added at the end.
 *
 * For convenience, varargs may be used when all arguments are numbers. This
 * allows creating geodesic EPSG:4326 LinearRings given an even number of
 * arguments, e.g.
 * ee.Geometry.LinearRing(aLng, aLat, bLng, bLat, ..., aLng, aLat).
 *
 * @param {!Array<!Array<number>>|
 *          Array<!ee.Geometry>|
 *          Array<number>} coords
 *     A list of points in the ring. May be a list of coordinates in the GeoJSON
 *     'LinearRing' format, a list of at least three ee.Geometry describing a
 *     point, or a list of at least six numbers defining the [x,y] coordinates
 *     of at least three points.
 * @param {ee.Projection=} opt_proj The projection of this geometry. If
 *     unspecified, the default is the projection of the input ee.Geometry, or
 *     EPSG:4326 if there are no ee.Geometry inputs.
 * @param {boolean=} opt_geodesic If false, edges are straight in the
 *     projection. If true, edges are curved to follow the shortest path on the
 *     surface of the Earth. The default is the geodesic state of the inputs, or
 *     true if the inputs are numbers.
 * @param {ee.ErrorMargin=} opt_maxError Max error when input geometry must be
 *     reprojected to an explicitly requested result projection or geodesic
 *     state.
 * @constructor
 * @extends {ee.Geometry}
 * @export
 */
ee.Geometry.LinearRing = function(
    coords, opt_proj, opt_geodesic, opt_maxError) {
  if (!(this instanceof ee.Geometry.LinearRing)) {
    return ee.Geometry.createInstance_(ee.Geometry.LinearRing, arguments);
  }
  goog.base(this, ee.Geometry.construct_(
      ee.Geometry.LinearRing, 'LinearRing', 2, arguments));
};
goog.inherits(ee.Geometry.LinearRing, ee.Geometry);



/**
 * Constructs an ee.Geometry describing a MultiLineString.
 *
 * For convenience, varargs may be used when all arguments are numbers. This
 * allows creating geodesic EPSG:4326 MultiLineStrings with a single LineString,
 * given an even number of arguments, e.g.
 * ee.Geometry.MultiLineString(aLng, aLat, bLng, bLat, ...).
 *
 * @param {!Array<!Array<!Array<number>>>|
 *          Array<!ee.Geometry>|
 *          Array.<number>}
 *     coords A list of linestrings. May be a list of coordinates in the GeoJSON
 *     'MultiLineString' format, a list of at least two ee.Geometry describing a
 *     LineString, or a list of number defining a single linestring.
 * @param {ee.Projection=} opt_proj The projection of this geometry. If
 *     unspecified, the default is the projection of the input ee.Geometry, or
 *     EPSG:4326 if there are no ee.Geometry inputs.
 * @param {boolean=} opt_geodesic If false, edges are straight in the
 *     projection. If true, edges are curved to follow the shortest path on the
 *     surface of the Earth. The default is the geodesic state of the inputs, or
 *     true if the inputs are numbers.
 * @param {ee.ErrorMargin=} opt_maxError Max error when input geometry must be
 *     reprojected to an explicitly requested result projection or geodesic
 *     state.
 * @constructor
 * @extends {ee.Geometry}
 * @export
 */
ee.Geometry.MultiLineString = function(
    coords, opt_proj, opt_geodesic, opt_maxError) {
  if (!(this instanceof ee.Geometry.MultiLineString)) {
    return ee.Geometry.createInstance_(ee.Geometry.MultiLineString, arguments);
  }
  goog.base(this, ee.Geometry.construct_(
      ee.Geometry.MultiLineString, 'MultiLineString', 3, arguments));
};
goog.inherits(ee.Geometry.MultiLineString, ee.Geometry);



/**
 * Constructs an ee.Geometry describing a polygon.
 *
 * For convenience, varargs may be used when all arguments are numbers. This
 * allows creating geodesic EPSG:4326 Polygons with a single LinearRing
 * given an even number of arguments, e.g.
 * ee.Geometry.Polygon(aLng, aLat, bLng, bLat, ..., aLng, aLat).
 *
 * @param {!Array<!Array<!Array<number>>>|
 *          Array<!ee.Geometry>|
 *          Array<number>}
 *     coords A list of rings defining the boundaries of the polygon. May be a
 *     list of coordinates in the GeoJSON 'Polygon' format, a list of
 *     ee.Geometry describing a LinearRing, or a list of number defining a
 *     single polygon boundary.
 * @param {ee.Projection=} opt_proj The projection of this geometry. The
 *     default is the projection of the inputs, where Numbers are assumed to be
 *     EPSG:4326.
 * @param {boolean=} opt_geodesic If false, edges are straight in the
 *     projection. If true, edges are curved to follow the shortest path on the
 *     surface of the Earth. The default is the geodesic state of the inputs, or
 *     true if the inputs are numbers.
 * @param {ee.ErrorMargin=} opt_maxError Max error when input geometry must be
 *     reprojected to an explicitly requested result projection or geodesic
 *     state.
 * @param {boolean=} opt_evenOdd If true, polygon interiors will be determined
 *     by the even/odd rule, where a point is inside if it crosses an odd number
 *     of edges to reach a point at infinity. Otherwise polygons use the left-
 *     inside rule, where interiors are on the left side of the shell's edges
 *     when walking the vertices in the given order. If unspecified, defaults to
 *     true.
 * @constructor
 * @extends {ee.Geometry}
 * @export
 */
ee.Geometry.Polygon = function(
    coords, opt_proj, opt_geodesic, opt_maxError, opt_evenOdd) {
  if (!(this instanceof ee.Geometry.Polygon)) {
    return ee.Geometry.createInstance_(ee.Geometry.Polygon, arguments);
  }
  goog.base(this, ee.Geometry.construct_(
      ee.Geometry.Polygon, 'Polygon', 3, arguments));
};
goog.inherits(ee.Geometry.Polygon, ee.Geometry);



/**
 * Constructs an ee.Geometry describing a MultiPolygon.
 *
 * For convenience, varargs may be used when all arguments are numbers. This
 * allows creating geodesic EPSG:4326 MultiPolygons with a single Polygon with a
 * single LinearRing given an even number of arguments, e.g.
 * ee.Geometry.MultiPolygon(aLng, aLat, bLng, bLat, ..., aLng, aLat).
 *
 * @param {!Array<!Array<!Array<!Array<number>>>>|
 *          Array<ee.Geometry>|
 *          Array<number>}
 *     coords A list of polygons. May be a list of coordinates in the GeoJSON
 *     'MultiPolygon' format, a list of ee.Geometry describing a Polygon, or a
 *     list of number defining a single polygon boundary.
 * @param {ee.Projection=} opt_proj The projection of this geometry. The
 *     default is the projection of the inputs, where Numbers are assumed to be
 *     EPSG:4326.
 * @param {boolean=} opt_geodesic If false, edges are straight in the
 *     projection. If true, edges are curved to follow the shortest path on the
 *     surface of the Earth. The default is the geodesic state of the inputs, or
 *     true if the inputs are numbers.
 * @param {ee.ErrorMargin=} opt_maxError Max error when input geometry must be
 *     reprojected to an explicitly requested result projection or geodesic
 *     state.
 * @param {boolean=} opt_evenOdd If true, polygon interiors will be determined
 *     by the even/odd rule, where a point is inside if it crosses an odd number
 *     of edges to reach a point at infinity. Otherwise polygons use the left-
 *     inside rule, where interiors are on the left side of the shell's edges
 *     when walking the vertices in the given order. If unspecified, defaults to
 *     true.
 * @constructor
 * @extends {ee.Geometry}
 * @export
 */
ee.Geometry.MultiPolygon = function(
    coords, opt_proj, opt_geodesic, opt_maxError, opt_evenOdd) {
  if (!(this instanceof ee.Geometry.MultiPolygon)) {
    return ee.Geometry.createInstance_(ee.Geometry.MultiPolygon, arguments);
  }
  goog.base(this, ee.Geometry.construct_(
      ee.Geometry.MultiPolygon, 'MultiPolygon', 4, arguments));
};
goog.inherits(ee.Geometry.MultiPolygon, ee.Geometry);


////////////////////////////////////////////////////////////////////////////////
//                              Instance methods.                             //
////////////////////////////////////////////////////////////////////////////////


/**
 * @param {function(*): *=} opt_encoder A function that can be called to encode
 *    the components of an object.
 * @return {*} An encoded representation of the geometry.
 */
ee.Geometry.prototype.encode = function(opt_encoder) {
  if (!this.type_) {
    // This is not a concrete Geometry.
    if (!opt_encoder) {
      throw Error('Must specify an encode function when encoding a ' +
                  'computed geometry.');
    }
    return ee.ComputedObject.prototype.encode.call(this, opt_encoder);
  }

  var result = {'type': this.type_};
  if (this.type_ == 'GeometryCollection') {
    result['geometries'] = this.geometries_;
  } else {
    result['coordinates'] = this.coordinates_;
  }

  if (goog.isDefAndNotNull(this.proj_)) {
    result['crs'] = {
      'type': 'name',
      'properties': {
        'name': this.proj_
      }
    };
  }

  if (goog.isDefAndNotNull(this.geodesic_)) {
    result['geodesic'] = this.geodesic_;
  }

  if (goog.isDefAndNotNull(this.evenOdd_)) {
    result['evenOdd'] = this.evenOdd_;
  }

  return /** @type {ee.data.GeoJSONGeometry} */(result);
};


/**
 * @return {ee.data.GeoJSONGeometry} A GeoJSON representation of the geometry.
 * @export
 */
ee.Geometry.prototype.toGeoJSON = function() {
  if (this.func) {
    throw new Error('Can\'t convert a computed Geometry to GeoJSON. ' +
                    'Use getInfo() instead.');
  }
  return /** @type {ee.data.GeoJSONGeometry} */(this.encode());
};


/**
 * @return {string} A GeoJSON string representation of the geometry.
 * @export
 */
ee.Geometry.prototype.toGeoJSONString = function() {
  if (this.func) {
    throw new Error('Can\'t convert a computed Geometry to GeoJSON. ' +
                    'Use getInfo() instead.');
  }
  return (new goog.json.Serializer()).serialize(this.toGeoJSON());
};


/**
 * @return {string} The serialized representation of this object.
 * @export
 */
ee.Geometry.prototype.serialize = function() {
  return ee.Serializer.toJSON(this);
};


/** @override */
ee.Geometry.prototype.toString = function() {
  return 'ee.Geometry(' + this.toGeoJSONString() + ')';
};



////////////////////////////////////////////////////////////////////////////////
//                              Implementation.                               //
////////////////////////////////////////////////////////////////////////////////


/**
 * Checks if a geometry looks valid.
 * @param {Object} geometry The geometry to validate.
 * @return {boolean} whether the geometry looks valid.
 * @private
 */
ee.Geometry.isValidGeometry_ = function(geometry) {
  var type = geometry['type'];
  if (type == 'GeometryCollection') {
    var geometries = geometry['geometries'];
    if (!goog.isArray(geometries)) {
      return false;
    }
    for (var i = 0; i < geometries.length; i++) {
      if (!ee.Geometry.isValidGeometry_(geometries[i])) {
        return false;
      }
    }
    return true;
  } else {
    var coords = geometry['coordinates'];
    var nesting = ee.Geometry.isValidCoordinates_(coords);
    return (type == 'Point' && nesting == 1) ||
        (type == 'MultiPoint' && (nesting == 2 || coords.length == 0)) ||
        (type == 'LineString' && nesting == 2) ||
        (type == 'LinearRing' && nesting == 2) ||
        (type == 'MultiLineString' && (nesting == 3 || coords.length == 0)) ||
        (type == 'Polygon' && nesting == 3) ||
        (type == 'MultiPolygon' && (nesting == 4 || coords.length == 0));
  }
};


/**
 * Validate the coordinates of a geometry.
 * @param {number|!Array.<*>} shape The coordinates to validate.
 * @return {number} The number of nested lists or -1 on error.
 * @private
 */
ee.Geometry.isValidCoordinates_ = function(shape) {
  if (!goog.isArray(shape)) {
    return -1;
  }
  if (goog.isArray(shape[0])) {
    var count = ee.Geometry.isValidCoordinates_(shape[0]);
    // If more than 1 ring or polygon, they should have the same nesting.
    for (var i = 1; i < shape.length; i++) {
      if (ee.Geometry.isValidCoordinates_(shape[i]) != count) {
        return -1;
      }
    }
    return count + 1;
  } else {
    // Make sure the coordinates are all numbers.
    for (var i = 0; i < shape.length; i++) {
      if (!goog.isNumber(shape[i])) {
        return -1;
      }
    }
    // Test that we have an even number of coordinates.
    return (shape.length % 2 == 0) ? 1 : -1;
  }
};


/**
 * Create a line from a list of points.
 * @param {IArrayLike} coordinates The points to convert.  Must be a
 *     multiple of 2.
 * @return {!Array<!Array<number>>} A list of pairs of points.
 * @private
 */
ee.Geometry.coordinatesToLine_ = function(coordinates) {
  if (!goog.isNumber(coordinates[0])) {
    return /** @type {!Array<!Array<number>>} */ (coordinates);
  }
  if (coordinates.length == 2) {
    return /** @type {!Array<!Array<number>>} */ (coordinates);
  }
  if (coordinates.length % 2 != 0) {
    throw Error('Invalid number of coordinates: ' + coordinates.length);
  }
  var line = [];
  for (var i = 0; i < coordinates.length; i += 2) {
    var pt = [coordinates[i], coordinates[i + 1]];
    line.push(pt);
  }
  return line;
};


/**
 * Constructs either a GeoJSON object or a ComputedObject for a JS geometry
 * constructor and its arguments.
 * @param {!Function} jsConstructorFn The JS geometry constructor called.
 * @param {string} apiConstructorName The name of the server-side geometry
 *     constructor to use.
 * @param {number} depth The nesting depth at which points are found within
 *     the coordinates array.
 * @param {!Arguments} originalArgs The arguments to the JS constructor.
 * @return {!Object|ee.ComputedObject} If the arguments are simple,
 *     a GeoJSON object describing the geometry. Otherwise a
 *     ComputedObject calling the appropriate server-side constructor.
 * @private
 */
ee.Geometry.construct_ = function(
    jsConstructorFn, apiConstructorName, depth, originalArgs) {
  var eeArgs = ee.Geometry.getEeApiArgs_(jsConstructorFn, originalArgs);

  // Standardize the coordinates and test if they are simple enough for
  // client-side initialization.
  if (ee.Geometry.hasServerValue_(eeArgs['coordinates']) ||
      goog.isDefAndNotNull(eeArgs['crs']) ||
      goog.isDefAndNotNull(eeArgs['geodesic']) ||
      goog.isDefAndNotNull(eeArgs['maxError'])) {
    // Some arguments cannot be handled in the client, so make a server call.
    // Note we don't declare a default evenOdd value, so the server can infer
    // a default based on the projection.
    var serverName = 'GeometryConstructors.' + apiConstructorName;
    return new ee.ApiFunction(serverName).apply(eeArgs);
  } else {
    // Everything can be handled here, so init a simple GeoJSON object.
    var geoJson = eeArgs;
    geoJson['type'] = apiConstructorName;
    geoJson['coordinates'] = ee.Geometry.fixDepth_(
        depth, geoJson['coordinates']);
    if (!goog.isDefAndNotNull(geoJson['evenOdd']) && goog.array.contains(
        ['Polygon', 'Rectangle', 'MultiPolygon'], apiConstructorName)) {
      // Default to evenOdd=true for any kind of polygon.
      geoJson['evenOdd'] = true;
    }
    return geoJson;
  }
};


/**
 * Creates an argument dictionary for a server-side geometry constructor from
 * the arguments to a JS geometry constructor. The arguments the JS constructor
 * can be passed as either a list of coordinates (as var_args), a sequence of
 * parameters, or a dictionary of named parameters.
 * @param {!Function} jsConstructorFn The JS constructor to parse arguments for.
 * @param {!Arguments} originalArgs The arguments to the JS constructor.
 * @return {!Object} The named server-side geometry constructor arguments.
 * @private
 */
ee.Geometry.getEeApiArgs_ = function(jsConstructorFn, originalArgs) {
  if (goog.array.every(originalArgs, ee.Types.isNumber)) {
    // All numbers, so convert them to a true array.
    return {'coordinates': goog.array.toArray(originalArgs)};
  } else {
    var args = ee.arguments.extract(jsConstructorFn, originalArgs);
    // Convert the argument dictionary to proper GeoJSON. Some of the parameter
    // names intentionally don't map precisely to GeoJSON key names.
    // For example, the server expects different CRS values than GeoJSON.
    args['coordinates'] = args['coords'];
    delete args['coords'];
    args['crs'] = args['proj'];
    delete args['proj'];
    return goog.object.filter(args, goog.isDefAndNotNull);
  }
};


/**
 * Returns whether any of the coordinates are computed values or geometries;
 * these types must be resolved by the server (evaluated in the case of computed
 * values, and processed to a single projection and geodesic state in the case
 * of geometries.)
 *
 * @param {!Array} coordinates A nested list of ... of number coordinates.
 * @return {boolean} Whether all coordinates are lists or numbers.
 * @private
 */
ee.Geometry.hasServerValue_ = function(coordinates) {
  if (goog.isArray(coordinates)) {
    return goog.array.some(coordinates, ee.Geometry.hasServerValue_);
  } else {
    return coordinates instanceof ee.ComputedObject;
  }
};


/**
 * Fixes the depth of the given coordinates, and checks that each element has
 * the expected depth as all other elements at that depth.
 *
 * @private
 * @param {number} depth The desired depth.
 * @param {!Array} coords The coordinates to fix.
 * @return {!Array} The fixed coordinates, with the deepest
 *     elements at the requested depth.
 */
ee.Geometry.fixDepth_ = function(depth, coords) {
  if (depth < 1 || depth > 4) {
    throw new Error('Unexpected nesting level.');
  }

  // Handle a list of numbers.
  if (goog.array.every(coords, goog.isNumber)) {
    coords = ee.Geometry.coordinatesToLine_(coords);
  }

  // Make sure the number of nesting levels is correct.
  var item = coords;
  var count = 0;
  while (goog.isArray(item)) {
    item = item[0];
    count++;
  }
  while (count < depth) {
    coords = [coords];
    count++;
  }

  if (ee.Geometry.isValidCoordinates_(coords) != depth) {
    throw Error('Invalid geometry');
  }

  // Empty arrays should not be wrapped.
  item = coords;
  while (goog.isArray(item) && item.length == 1) {
    item = item[0];
  }
  if (goog.isArray(item) && item.length == 0) {
    return [];
  }

  return /** @type {!Array} */ (coords);
};


/**
 * Creates an instance of an object given a constructor and a set of arguments.
 * @param {function(this:T, ...?): T} klass The class constructor.
 * @param {Arguments} args The arguments to pass to the constructor.
 * @return {T} The new instance.
 * @template T
 * @private
 */
ee.Geometry.createInstance_ = function(klass, args) {
  /** @constructor */
  var f = function() {};
  f.prototype = klass.prototype;
  var instance = new f();
  var result = klass.apply(instance, args);
  return result !== undefined ? result : instance;
};


/** @override */
ee.Geometry.prototype.name = function() {
  return 'Geometry';
};
