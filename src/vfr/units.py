"""The length conversions more than one module makes, in one place.

Standard library only, so a module that keeps its imports light (vfr.weather
stays free of the terrain and chart data, vfr.glmp of everything but its
GRIB reader) can take them without bringing anything else in.
"""

#: Feet in a metre: the international foot is 0.3048 m exactly (NIST
#: Handbook 44, Appendix C), so 3.28084 to five places. The terrain tiles,
#: the USGS and NOAA grids and a TAF station's elevation come in metres;
#: everything a pilot reads is in feet.
M_TO_FT = 3.28084

#: Metres in a nautical mile: 1,852 exactly by international definition
#: (NIST Handbook 44, Appendix C).
M_PER_NM = 1852.0
