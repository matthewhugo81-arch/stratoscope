# Stored 500 hPa climate reference

`height-500-ncep-1991-2020.npz` contains only the 500 hPa, 30–90°N subset of NOAA PSL's NCEP/NCAR Reanalysis 1 **1991–2020 daily long-term mean**. The matching JSON records the source, checksum, grid, calendar and period. It is not ERA5 and is independent of the seasonal wind reference.

Reproduce explicitly with `python scripts/prepare-height-climatology.py` and `netCDF4==1.7.4`. The extractor checks every grid point has all 30 input years before storing the data. Recurring forecast jobs read this stored subset; they do not request climate data.

The provider supplies 365 calendar days. February 29 uses the mean of February 28 and March 1. March onward is aligned by month/day, never by the leap year's ordinal day. The 2.5° reference is bilinearly interpolated to 1°, with periodic longitude. Forecast anomalies are the mean of all 31 GEFS members minus that calendar-day reference, in metres, without model-bias correction or standardisation. The reference is a daily mean; forecast fields are instantaneous.

Source: https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis/Monthlies/pressure/hgt.day.ltm.1991-2020.nc

Data provided by NOAA Physical Sciences Laboratory, Boulder, Colorado, USA, from their website at https://psl.noaa.gov/. NCEP/NCAR Reanalysis 1: Kalnay et al., 1996, *The NCEP/NCAR 40-Year Reanalysis Project*, Bulletin of the American Meteorological Society.
