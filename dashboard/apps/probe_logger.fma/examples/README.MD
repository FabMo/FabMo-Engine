Key Differences from DATA_SEND

Feature	               DATA_SEND             	DATA_REQUEST
--------------------------------------------------------------------
Blocking	  No - continues immediately	Yes - waits for response
Return Value	        None	            %(25) contains response
Timeout              	N/A	                     30 seconds
Use Case	     Logging, monitoring	     User input, decisions
App Response	Optional (listen only)	    Required (must respond)
