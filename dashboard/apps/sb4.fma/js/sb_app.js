/**
 ***** Main js functionality for SB4 Commands *****  
 **/

 // Main Entry for 2-Letter Commands from the Sb4 Console
function sendCmd(command) {
    //check for focus and if nothing entered, take a shot at this being a re-run of the last file
    if (($('cmd-input').focus) && ($('#cmd-input').val() === '') && (typeof command === 'undefined') && (globals.FIll_In_Open === false)) {  // If nothing entered, take a shot at this being a re-run of the last file
        command = "FL"; // First part of ENTER-ENTER to re-run last file
        processCommandInput(command);
    } else {
        var thisCmd = command || $('#cmd-input').val();
        $('#cmd-input').val('');    // remove after sent or called
        $("#cmd-help").css("visibility","hidden");
        postSbpAction(thisCmd);
        // Some Commands Need 'SV' to make permanent because each command run like a file; thus need a multiline version
        var cmd_eval = thisCmd.substring(0,2);
        console.log(thisCmd);
        switch (cmd_eval) {
            case "VS":
                var mult_cmds=[
                thisCmd,
                'SV'						        // Make Permanent
                ].join("\n");
                fabmo.runSBP(mult_cmds);	        // SEND MULTI >>>  
                break;
            case "MS":
                var mult_cmds=[
                thisCmd,
                'SV'						        // Make Permanent
                ].join("\n");
                fabmo.runSBP(mult_cmds);	        // SEND MULTI >>>  
                break;
            default:
                fabmo.runSBP(thisCmd);    	        // SEND SIMPLE >>>
                break;
        }
    }        
}   

// For any linked resources, use the fabmo.navigate function to open them
// This is a simplified STANDARD Call FOR doc reference like Tooltip system ... for location in a PDF: ... .pdf#'tag (if correctly saved in the PDF with Word bookmarks)'
function getUsrResource(remote, local) { // just a simplified version of fabmo.navigate for sb4
    fabmo.navigate(
        local,                           // Local fallback
        {target: "_blank"},              // Open in new tab
        remote,                          // Online version
        function(err, result) {
            if (err) {
                console.error("Navigation failed:", err);
            } else {
                console.log("Successfully opened documentation");
            }
        }
    );

  $('#cmd-input').val('');
}

// Display after entry of simple Command in Console
function postSbpAction(action) {
  setTimeout(function() { 
    $("#file_txt_area").text("-------Running:" + '\n' + "    " + action); }, 
    200);
}

// Try and Keep Focus in the Command Input Box; except when it should not be
function setSafeCmdFocus(site) {     // too easy to walk on Manual Keypad (not sure why?); so protect
  console.log("got safeCheck", site) // site for debugging flow
    if (globals.FAbMo_state === "manual") {
        return;
    }
    if (globals.FIll_In_Open === true) {    // let fill-in keep focus ;;; was problematic with ENTER
        //  $("#fi_1").focus();
        return;
    }
    if (globals.INject_inputbox_open) {
        $("#insert-input").focus();
    } else {
        $("#cmd-input").focus();
    }
}

function getLastJob(callback) {
    // check history to identify last job
    fabmo.getJobHistory({
        start: 0,
        count: 0
    }, function(err, jobs) {
        if (err) {
            console.error(err);
            callback(err, null);
            return;
        }
        var arr = jobs.data;
        var lastJob = arr[0];
        callback(null, lastJob);
    });
}

// Display Fill-In Dialog Box for certain Commands
function displayFillIn(command, title, info) {
    $(".fi-listing").empty();
    $("#fill_in_table").css("overflow-y", "scroll");

    if (title.substring(0,4) === "File") { // handle an FP run file case
        $("#fill_in_table").css("overflow-y", "hidden");
        $('#fill_in_table').css("visibility", "hidden");
        $('#btn_adv_file').show();
        $('#btn_ok_run').text("OK-Run")
        $('#btn_ok_run').focus();
    } else if (title.substring(0,5) === "Rerun") { // handle an FL run last file case
        $("#fill_in_table").css("overflow-y", "hidden");
        $('#fill_in_table').css("visibility", "hidden");
        $('#btn_adv_file').show();
        $('#btn_ok_run').text("OK-Run")
        $('#btn_ok_run').focus();
    } else {
        $("#fill_in_table").css("overflow-y", "scroll");
        $('#fill_in_table').css("visibility", "visible");
        $('#btn_adv_file').hide();
        $('#btn_ok_run').text("Run Command");
        console.log(cmds[command])
        param_num = 0;
        cmds[command].params.forEach(function(entry) {
            let dispSymbol = "";
            if (entry.disptype ==="2") {dispSymbol = "*"} ;
            let setVal = "";
            if (entry.default) {setVal = entry.default} ;
            let str_colon = dispSymbol + " : ";
            param_num += 1;
            // get itemInfo for tooltip to display all the value: and desc: from opts array when either type:= "opt" or type:= "ck" 
            let itemInfo = "";
            if (entry.type === "opt" || entry.type === "ck" || entry.type === "sng") {
                if (entry.opts) {
                    entry.opts.forEach(function(item) {
                        itemInfo += item.value + " = " + item.desc + "\n";
                    });
                    if (entry.type === "ck" && itemInfo === "") {
                        itemInfo = "0 = No\n1 = Yes\n";
                    }
                }        
            }
            html = [
                '<tr>',
                    '<td class="fi_name " title="' + entry.desc + '"><input value="' + entry.name + str_colon + '" tabindex="-1"></td>',
                    '<td class="fi_val" title="' + itemInfo + '"><input id="fi_' + param_num + '" value="' + setVal + '"></td>',
                '</tr>'
            ].join('');
            $(".fi-listing").append(html);
        });
    }

    $('#fi_cur_info').empty();
    if (info === "") {
        $('#fi_cur_info').append("Editing Parameters: complete required(*) fields; over-write defaults as needed; and/or provide {optional} values.")
    } else {
        $('#fi_cur_info').append(info);
    }
    $('#fi_modal_title').empty();
    $('#fi_modal_title').append(title);
    $('#fi-modal').trigger("reset");
    $('#fi-modal').foundation('reveal', 'open');
    globals.FIll_In_Open = true;
    $("#cmd-input").val(command);
    $("#cmd-input").focus();         // put focus here to collect an ENTER as a RUN
}

function getaFile(command) {
    if (globals.usbDrive) {
        fabmo.showUSBFileBrowser({ app: "sb4" }, function(err, result) {
            if(result && result.filePath) {
                // Set the global variable for the file path and name
                window.curFilePath = result.filePath;
                window.curFilename = result.filePath.split('/').pop();
                displayFillIn("", "File Ready to Run", window.curFilename);
            }
        });
    } else {
        $("#fi_cur_info").text("");
        $("#cmd-input").val(command);
        $('#file').val('');
        $('#file').trigger('click');
        $("#cmd-input").val("... downloading file to tool ...");
    }
}
window.getaFile = getaFile;

// Listen for the custom event from usb-browser.js for shifting to computer selection
window.top.document.addEventListener("usbFileSelection", function (event) {
  jQuery("#file").trigger("click");
});


// MAIN COMMAND HANDLER for 2-Letter Commands
function processCommandInput(command) {
    console.log('got first command letter')
    var command = command.trim().toUpperCase();
    if (command.length == 1) {
        switch (command) {
        case "F":
            $("#cmd-input").val(command);
            $("#menu_files").click();
            break;
        case "M":
            $("#cmd-input").val(command);
            $("#menu_moves").click();
            break;
        case "J":
            $("#cmd-input").val(command);
            $("#menu_jogs").click();
            break;
        case "C":
            $("#cmd-input").val(command);
            $("#menu_cuts").click();
            break;
        case "Z":
            $("#cmd-input").val(command);
            $("#menu_zero").click();
            break;
        case "S":
            $("#cmd-input").val(command);
            $("#menu_settings").click();
            break;
        case "V":
            $("#cmd-input").val(command);
            $("#menu_values").click();
            break;
        case "T":
            $("#cmd-input").val(command);
            $("#menu_tools").click();
            break;
        case "D":
            $("#cmd-input").val(command);
            $("#menu_design").click();
            break;
        case "H":
            $("#cmd-input").val(command);
            $("#menu_help").click();
            break;
        default:
            command = "";
            event.preventDefault();   // ESC as a general clear and update tool
            curLine = "";             // Remove after sent or called
            $(".top-bar").click();    // ... and click to clear any dropdowns
            $("#file_txt_area").text("");
            $("#cmd-input").val(command);
            setSafeCmdFocus();
            break;
        }

    } else if (command.length == 2) {
        // HANDLE COMMANDS (that are direct action single commands; NO STOP for ENTER)                                        
        switch (command) {
        case "JH":
        case "MH":
        case "SA":
        case "SR":
        case "SF":
        case "ST":
        case "ZX":
        case "ZY":
        case "ZZ":
        case "ZA":
        case "ZB":
        case "ZC":
        case "Z2":
        case "Z3":
        case "Z4":
        case "Z5":
        case "Z6":
        case "ZT":    
        case "C1":
        case "C2":
        case "C3":
        case "C4":  
        case "C5":  
        case "C6":  
        case "C7":  
        case "C8":  
        case "C9":
            sendCmd(command);
            break;
        case "FP":
            getaFile(command);  // get a file to run
            break;
        case "FL": 
            $("#cmd-input").val("... downloading file to tool ...");  // ... just a little message to show we're working
            fabmo.clearJobQueue(function (err, data) {
                if (err) {
                    cosole.log(err);
                } else {
                    getLastJob(function(err, lastJob) {
                        if (err) {
                            console.error("Error fetching last job:", err);
                        } else {
                            console.log("Last job:", lastJob);
                            if (lastJob && lastJob._id) {
                                fabmo.resubmitJob(lastJob._id, { stayHere: true }, function(err, result) {
                                    if (err) {
                                        console.error("Error resubmitting job:", err);
                                    } else {
                                        console.log("Job resubmitted successfully:", lastJob.name);
                                    }
                                });
                                displayFillIn("", "Rerun File; Ready to Run", lastJob.name);
                            } else {
                                console.log("No recent job to rerun.");
                                fabmo.notify("info", "No recent job to rerun!");
                                $('#cmd-input').val("");    // remove 
                            }
                        }
                    })
                }
            });
            break;
        case "FE":
            getLastJob(function(err, lastJob) {
                if (err) {
                    console.error("Error fetching last job:", err);
                } else {
                    console.log("Last job:", lastJob);
                    if (lastJob && lastJob._id) {
                        fabmo.launchApp('editor', {
                            'job': lastJob._id
                        });
                    } else {
                        console.log("No recent job to edit.");
                        fabmo.notify("info", "No recent job to edit!");
                        $('#cmd-input').val("");    // remove 
                    }
                }
            })
            break;
        case "FN":
            fabmo.launchApp('editor', {
                'new': true,
                'content': "' Create a new OpenSBP part file here ... (change Language for Gcode)",
                'language': 'sbp'
            });
            break;
        case "FR":
            fabmo.launchApp('job-manager', {
                'tab': "nav-history"
            });
            break;
    }

        // HANDLE COMMANDS (with a FILL-IN sheet)
        switch (Array.from(command)[0]) {
            case "C":
                if (command === "CN" || command === "C#") {  // let these two filter on through
                    break;
                }
            case "T":
            case "S":
            case "V":        
                let titleCmd = "", parameters = "";
                titleCmd = command + ": " + cmds[command].name;
                displayFillIn(command, titleCmd, "");
                $("#cmd-input").focus();
                break;
        }

        // HANDLE COMMANDS (misc special command filtering)
        switch (command) {
            case "SI": // obsolete
            // INTERESTING POSSIBLE USE of call to another local server
            //                                                                        // case "TR":                                                             // testing some Node-Red stuff ... **added to this sbp3_commands
            //     let tempip = window.globals.ORigin + ':1880/ui';
            //     getUsrResource(tempip, 'assets/docs/No_Internet.pdf');
            //     break;        
            // DESIGN PAGE TURNED OFF FOR NOW
            case "DE":                                                             // testing some design stuff ... **added to this sbp3_commands
                getUsrResource('http://easel.inventables.com/users/sign_in', 'assets/docs/No_Internet.pdf');
                break;        
            case "DA":
                getUsrResource('https://www.inventables.com/technologies/easel', 'assets/docs/No_Internet.pdf');
                break;
            case "DT":
                //getUsrResource('https://www.tinkercad.com/dashboard', 'assets/docs/No_Internet.pdf'); // also '/join' or '/login'
                getUsrResource('https://www.tinkercad.com/login', 'assets/docs/No_Internet.pdf');
                break;        

            // Need new version of About for SB4
            // case "HA":
            //     // version info for this app from fabmo.js api call to fabmo engine ...  
            //     console.log("at HA");
            //     $('#cmd-input').val('');
            //     fabmo.notify('info', 'About: not getting AppInfo from FabMo');
            //     fabmo.getAppInfo(function(err, info) {
            //         console.log("appinfo " + info); 
            //         fabmo.notify('info', 'About: not getting AppInfo from FabMo');
            //     });
            //     break;
            case "HC":
                getUsrResource('docs/ComRef.pdf', 'docs/ComRef.pdf');      // Open the local ComRef.pdf in the dashboard docs folder for the moment 
                break;        
            // Need to be able to click anywhere to close HL
            case "HL":
                    $('#cmd-input').val('');
                    var cachedConfig = null;
                    // Get the configuration from the tool and update
                    var updateConfig = function() {
                        fabmo.getConfig(function(err, config) {
                            // Update the configuration 
                            cachedConfig = config;
                            document.getElementById('full-config').innerHTML = JSON.stringify(config, null, '   ');
                        });			
                    }
                // Update it
                $('#helpModal').foundation('reveal', 'open');
                updateConfig();
                break;        
            case "HF":
                getUsrResource('https://www.talkshopbot.com/forum/forum.php', 'assets/docs/No_Internet.pdf');
                break;        
            case "HW":
                getUsrResource('https://www.shopbottools.com', 'assets/docs/No_Internet.pdf');
                break;        
            case "HQ":
                getUsrResource('http://docs.handibot.com/doc-output/Handibot2_Unboxing.pdf', 'assets/docs/Handibot 2 MANUAL Unboxing Source_v004.pdf');
                break;        
            case "HS":
                getUsrResource('http://docs.handibot.com/doc-output/Handibot2_Safety.pdf', 'assets/docs/Handibot 2 MANUAL Safe Use Source_v002.pdf');
                break;        
            default:
                var newCommandString = command + ", ";
                $("#cmd-input").val(newCommandString);                        // Set Command letters for default case
                setSafeCmdFocus();
                $("#cmd-help").text("?" + newCommandString.substring(0, 2));  // Show the helper button  
                $("#cmd-help").css("visibility","visible");
                break;
        }
        if ((globals.LIcmds).includes(command)) {  // and if we still have something that is in our list
            return true;
        } else {
            // HANDLE COMMAND: Deal with incorrect second Command key
            let trunkated = command.substring(0, 1);
            $("#cmd-input").val(trunkated);
            return false
        }
    }

    if (command.length > 2) {
        return true;
    }    

}
