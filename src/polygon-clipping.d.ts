// The published ESM build of polygon-clipping only has a default export, while
// its bundled types declare named exports. Augment the module with the default
// export so we can import it the way it actually ships.
declare module "polygon-clipping" {
  const polygonClipping: {
    union(geom: Polygon | MultiPolygon, ...geoms: (Polygon | MultiPolygon)[]): MultiPolygon;
    intersection(
      geom: Polygon | MultiPolygon,
      ...geoms: (Polygon | MultiPolygon)[]
    ): MultiPolygon;
    xor(geom: Polygon | MultiPolygon, ...geoms: (Polygon | MultiPolygon)[]): MultiPolygon;
    difference(
      subjectGeom: Polygon | MultiPolygon,
      ...clipGeoms: (Polygon | MultiPolygon)[]
    ): MultiPolygon;
  };
  export default polygonClipping;
}
