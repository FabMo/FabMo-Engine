CMD,FullName(25),mOrder,#par,#line,type,dispType,dispSet,last/cur
Version 300,152,,English,,,,,
1,1024,4,4,4,4,4,1,
3,8,8,4,4,4,0,,
15000,0.75,0.10,0.05,,,,,
1,75,50,1000,,,,,
1,,,,,,,,
"Part Files (*.sbp)|*.sbp|Default Config Files(*.sbd)|*.sbd|Custom Cut Files (*.sbc)|*.sbc|Rotary Files (*.sbr)|*.sbr|All ShopBot Files (*.sb*)|*.sb*|G Code Files (*.gcc, *.tap, *.nc, *.agc)|*.gcc;*.tap;*.nc;*.agc|All Files (*.*)|*.*",,,,,,,,
131,commands start,,,,,,,
FP,[&P]ART FILE LOAD,1,11,17,F,1,1,0
FE,part file [&E]dit,2,1,4,F,1,1,0
F/1,<seperator>,3,0,0,F,2,0,0
FN,[&N]ew blank part file,4,0,0,F,1,1,0
FG,[&G]oto line / single step,5,11,17,F,1,1,0
FC,file [&C]onversions,6,1,1,F,1,1,0
FS,file [&S]et part file folder,7,3,3,F,1,1,1
MX,move [&X] axis,1,1,3,M,1,0,0
MY,move [&Y] axis,2,1,3,M,1,0,0
MZ,move [&Z] axis,3,1,3,M,1,0,0
M2,move in [&2] axes (X and Y),4,2,4,M,1,0,0
M3,move in [&3] axes,5,3,5,M,1,0,0
MD,move [&D]istance at Angle,6,3,5,M,1,1,1
MH,move [&H]ome (X and Y; Z Safe Height),7,0,0,M,1,0,0
M/1,<seperator>,8,0,0,M,2,4,0
MA,move [&A] axis,9,1,3,M,4,0,0
MB,move [&B] axis,10,1,3,M,5,0,0
M4,move in [&4] axes,11,4,6,M,4,0,0
M5,move in [&5] axes,12,5,7,M,5,0,0
M/2,<seperator>,13,0,0,M,2,0,0
MN,move [&N]udge,14,0,0,M,1,0,0
MI,move [&I]ndexer or Oscillate,15,5,12,M,1,1,0
M0,motors [&0]FF,16,0,0,M,1,0,0
MO,motors [&o]FF,17,0,0,M,1,0,0
MS,move [&S]peeds,18,4,4,M,1,1,1
JX,jog [&X] axis,1,1,3,J,1,0,0
JY,jog [&Y] axis,2,1,3,J,1,0,0
JZ,jog [&Z] axis,3,1,3,J,1,0,0
J2,jog in [&2] axes(X and Y),4,2,4,J,1,0,0
J3,jog in [&3] axes,5,3,5,J,1,0,0
JH,jog [&H]ome (X and Y; Z Safe Height),6,0,0,J,1,0,0
J/1,<seperator>,7,0,0,J,2,4,0
JA,jog [&A] axis,8,1,3,J,4,0,0
JB,jog [&B] axis,9,1,3,J,5,0,0
J4,jog in [&4] axes,10,4,6,J,4,0,0
J5,jog in [&5] axes,11,5,7,J,5,0,0
JS,jog [&S]peeds,12,4,4,J,1,1,1
CC,cut [&C]ircle,1,12,23,C,1,1,0
CP,cut center [&P]oint circle,2,14,25,C,1,1,0
CA,cut [&A]rch,3,12,20,C,1,1,0
CG,cut [&G]-code circle,4,14,25,C,1,1,0
C/1,<seperator>,5,0,0,C,2,0,0
CR,cut [&R]ectangle,6,11,22,C,1,1,0
C/2,<seperator>,7,0,0,C,2,0,0
CS,[&S]etup custom cuts,8,0,0,C,1,0,0
CN,Custom [&N]umber,9,1,1,C,1,1,0
C#,Custom Number [&#],10,1,1,C,0,0,0
ZX,zero [&X] axis,1,0,0,Z,1,0,0
ZY,zero [&Y] axis,2,0,0,Z,1,0,0
ZZ,zero [&Z] axis,3,0,0,Z,1,0,0
Z2,zero [&2] axes (X and Y),4,0,0,Z,1,0,0
Z3,"zero [&3] axes (X, Y and Z)",5,0,0,Z,1,0,0
Z/1,<seperator>,6,0,0,Z,2,4,0
ZA,zero [&A] axis,7,0,0,Z,4,0,0
ZB,zero [&B] axis,8,0,0,Z,5,0,0
Z4,zero [&4] axes,9,0,0,Z,4,0,0
Z5,zero [&5] axes,10,0,0,Z,5,0,0
Z/2,<seperator>,11,0,0,Z,2,0,0
ZT,zero [&T]able base coordinates,12,0,0,Z,1,0,0
SA,set to [&A]bsolute mode,1,0,0,S,1,0,1
SC,set [&C]ontinuous,2,1,3,S,0,0,1
SF,set [&F]ile limit checking,3,1,1,S,1,1,1
SI,send Command L[&I]nes { I },4,10,11,S,1,1,0
SK,set to [&K]eyPad control w/ arrow keys { K },5,0,0,S,1,0,1
SL,c[&L]ear User Variables,6,0,0,S,1,0,1
SM,set to [&M]ove/Cut mode,7,0,0,S,1,0,1
SO,set [&O]utput,8,2,2,S,1,1,0
SP,set to [&P]review mode,9,0,0,S,1,0,1
SR,set to [&R]elative mode,10,0,0,S,1,0,1
SS,set Window [&S]ize and location to defaults,11,0,0,S,1,0,0
ST,set to [&T]able base coordinates,12,0,0,S,1,1,0
SV,set [&V]alues,13,0,0,S,0,0,0
SW,set [&W]arning duration,14,3,3,S,1,1,1
VC,[&C]utter values,1,12,13,V,1,1,1
VP,[&P]review screen values,2,10,14,V,1,1,1
VV,define [&V]ariable values,3,2,4,V,1,1,0
VS,[&S]peed values,4,8,10,V,1,1,1
VR,[&R]amp values,5,16,18,V,1,1,1
VB,ta[&B]bing values,6,7,8,V,1,1,1
VT,[&T]olerance values,7,0,0,V,0,0,1
VA,[&A]xis location values,8,12,12,V,1,1,0
VU,[&U]nit values,9,15,17,V,1,1,1
VD,[&D]isplay values,10,18,30,V,1,1,1
VL,[&L]imits for table,11,12,17,V,1,1,1
VE,[&E]nd angle for circle,12,0,0,V,0,0,0
VK,bac[&K]lash values,13,0,0,V,0,0,1
VI,[&I]nputs/driver definitions,14,11,15,V,1,1,1
VN,i[&N]put/output switch modes,15,25,134,V,1,1,1
VH,torch [&H]eight or laser,16,7,8,V,1,1,1
VO,temporary tool [&O]ffset,17,7,8,V,1,1,0
T1,virtual tool #[&1],1,0,0,T,1,1,1
RR,replay [&R]ecent commands,1,2,2,R,1,1,0
RP,re[&P]lay all commands,2,0,0,R,1,0,0
RS,[&S]ave recorded commands,3,2,2,R,1,1,0
RA,[&A]ctivate command recording,4,0,0,R,1,0,0
RI,[&I]nactivate command recording,5,0,0,R,1,0,0
RZ,[&Z]ero (clear) command record,6,0,0,R,1,0,0
UU,calc[&U]lator,1,0,0,U,1,0,1
U/1,<seperator>,2,0,0,U,2,0,1
UL,[&L]ist current variables,3,0,0,U,1,0,1
UV,view [&V]alues and settings,4,0,0,U,1,0,1
UR,"[&R]eset default Settings, load a Custom Setting File, or clear System Log",5,0,0,U,1,0,0
US,[&S]ave current Settings to a Custom Settings File ,6,1,1,U,1,1,0
UN,[&N]ame of editor,7,1,1,U,1,1,1
U/2,<seperator>,8,0,0,U,2,0,1
UZ,[&Z]ero ALL Current Locations and Table Base Coordinates,9,0,0,U,1,0,1
U/3,<seperator>,10,0,0,U,2,0,1
UD,[&D]iagnostic information,11,0,0,U,1,0,1
UT,notes on diagnos[&T]ic information,12,0,0,U,1,0,1
U/4,<seperator>,13,0,0,U,2,0,1
UI,[&I]nstall Control Box Firmware,14,0,0,U,1,0,1
HQ,[&Q]uick Start for beginning ShopBotters,1,0,0,H,1,0,1
H/1,<seperator>,2,0,0,H,2,0,1
HC,[&C]ommand Reference,3,0,0,H,1,0,1
HR,Quick [&R]ef to Command Summary,4,0,0,H,1,0,1
HE,Quick Ref for [&E]diting Part Files,5,0,0,H,1,0,1
H/2,<seperator>,6,0,0,H,2,0,1
HK,[&K]eyboard Shortcuts,7,0,0,H,1,0,1
HS,[&S]quaring the X Car,8,0,0,H,1,0,1
HZ,[&Z]eroing and Table Base Coordinates,9,0,0,H,1,0,1
HF,ShopBot User [&F]orum *,10,0,0,H,1,0,1
HW,ShopBot [&W]ebsite *,11,0,0,H,1,0,1
HP,[&P]rogramming and Developer Resources,12,0,0,H,1,0,1
H/3,<seperator>,13,0,0,H,2,0,1
HD,ShopBot User [&D]ata Files (view),14,0,0,H,1,0,1
HI,[&I]nfo on Control Card Diagnostic LEDs,14,0,0,H,1,0,1
HM,Re[&m]ote PC Help from ShopBot Support,15,0,0,H,1,0,1
H/4,<seperator>,16,0,0,H,2,0,1
HA,help [&A]bout,17,0,0,H,1,0,1
H/5,<seperator>,18,0,0,H,2,0,1
H5,.                        *-requires internet connection,19,0,0,H,1,0,1
