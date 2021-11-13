# fabmo-profile-dt
FabMo machine profile for the ShopBot Desktop (DT3).

# macros - NOTES on macros
While these are updated versions of macros for FabMo; not all variable functionality is in place in FabMo usages.
Thus, there is some hard-coding in macros here for temporary use.

# macros - NOTES for ShopBot Dev Team
This is an updated version of FabMo Macros for "FabMo DT Release 2021".
These will be similar to the previous Macro system ... 

There are a couple of new things that would be good to achieve:
.. As much as possible, use the same Macros for all tools
    some tools use more of them (like ATC) but homing, for example, should be standard
.. Macros should handle units and unexpected tool units as seamlessly as possible
    including if cutter offset is measured in a different unit system

To help with interchangeability we employ a set of standard variables whose values are
then set or each tool. This is set up in Macro #199.

I am expecting that we will add to the system for standard variables as time goes by, but I've tried to cover all the ones for low-number Macros in this first batch.

Checkout these new standard variable definitions are in Macro #199.

We need to call this macro once, just after any new profile is installed.

