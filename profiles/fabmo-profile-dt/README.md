# fabmo-profile-dt
FabMo machine profile for the ShopBot Desktop (DT3).

# macros - NOTES for ShopBot Dev Team
This is an updated version of FabMo Macros for "FabMo DT Release 2021".
These will be similar to the previous Sb3 Macro system ... 

There are a couple of new things that would be good to achieve:
.. As much as possible, use the same Macros for all tools
    some tools use more of them (like ATC) but homing, for example, should be standard
.. Macros should handle units and unexpected tool units as seamlessly as possible
    including if cutter offset is measured in a different unit system; this makes these
    a bit more complicated (unit conversion is handled at the bottom of macro)

To help with interchangeability we employ a set of "Standard Variables" whose "Values" are
set or each tool. This is set up in Macro #201.

