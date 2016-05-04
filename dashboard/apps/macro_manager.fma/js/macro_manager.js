var macroIndex = {};

function getMacroFromClick(elem) {
    var id = $(elem).closest('tr').data('macro');
    return macroIndex[id];
}

function clearMacroTable() {
    var table = document.getElementById('macro_table');
    var rows = table.rows.length;
    for(var i=0; i<rows; i++) {
        table.deleteRow(0);
    }
}

function addMacros(macros, callback) {
    callback = callback || function() {};
    var table = document.getElementById('macro_table');
    macros.forEach(function(macro) {
        var row = table.insertRow(table.rows.length);
        var playCell = row.insertCell(0);
        var numberCell = row.insertCell(1);        
        var nameCell = row.insertCell(2);
        var descriptionCell = row.insertCell(3);
        var editCell = row.insertCell(4);
        var deleteCell = row.insertCell(5);

        row.dataset.macro = macro.index;


        numberCell.className = 'number';        
        numberCell.innerHTML = '<input class="field" type="number" data-fieldname="index"></input>';
        numberCell.firstChild.setAttribute('value', macro.index);

        nameCell.className = 'name';
        nameCell.innerHTML = '<input class="field" type="text" data-fieldname="name"></input>';
        nameCell.firstChild.setAttribute('value', macro.name);

        descriptionCell.className = 'description';
        descriptionCell.innerHTML = '<input class="field" type="text" data-fieldname="description"></input>';
        descriptionCell.firstChild.setAttribute('value', macro.description);

        playCell.className = 'run-control';
        playCell.innerHTML = '<img class="svg" src="css/images/play_icon.png">'

        deleteCell.className = 'delete-control';
        deleteCell.innerHTML = '<img class="svg" src="css/images/recycling10.svg">'
        
        editCell.className = 'edit-control';
        editCell.innerHTML = '<img class="svg" src="css/images/edit_icon.png">'

    });

    $('.run-control').click(function(evt) {
        var macro = getMacroFromClick(this);
        fabmo.runMacro(macro.index, function(err, data) {
            if(err) {
                fabmo.notify('error', err.message || err);
            }
            refreshMacros();
        });
    });

    $('.delete-control').click(function(evt) {
        var macro = getMacroFromClick(this);
        fabmo.deleteMacro(macro.index, function(err, data) {
            if(err) {
                fabmo.notify('error', err.message || err);
            } else {
                fabmo.notify('success', 'Macro "' + macro.name + '" was deleted.');
            }
            refreshMacros();
        });
    });

    $('.edit-control').click(function(evt) {
        var macro = getMacroFromClick(this);
        fabmo.launchApp('editor', {'macro' : macro.index});
    });

    $('.field').change(function(evt) {
        var newValue = $(this).val();
        var fieldName = this.dataset.fieldname;
        var macro = getMacroFromClick(this);
        var update = {};
        update[fieldName] = newValue;
        fabmo.updateMacro(macro.index, update, function(err, result) {
            refreshMacros();
        });   
    });
}

function updateMacroIndex(macros) {
    macroIndex = {};
    macros.forEach(function(item) {
        macroIndex[item.index] = item;
    });
}

function refreshMacros(callback) {
    callback = callback || function() {};
    clearMacroTable();
    fabmo.getMacros(function(err, macros) {
        if(err) {
            return callback(err);
        }
        updateMacroIndex(macros);
        addMacros(macros);
        callback(null);
    });
}



          $(document).ready(function() {

            //Foundation Init
            $(document).foundation();
            
            refreshMacros();

            
            $('#macro-new').on('click', function(evt) {
                var macroCount = Object.keys(macroIndex).length;
                for(var newIndex=1; newIndex<macroCount+1; newIndex++) {
                    if(!macroIndex[newIndex]) {
                        break;
                    }
                }
                fabmo.updateMacro(newIndex, {}, function(err, result) {
                    if(err) {
                        fabmo.notify('error', err);                        
                    }
                    refreshMacros();
                });
                evt.preventDefault();
            }); 
/*
        
            $('#macro-new').on('click', function(evt) {
                var indices = macro_table.columns(1).data().toArray()[0];
                var new_idx = indices.length > 0 ? Math.max.apply(null, indices) + 1 : 1;
                fabmo.updateMacro(new_idx, {}, function(err, result) {
                    macro_table.ajax.reload();
                    fabmo.notify('error', err);
                });
                evt.preventDefault();
            }); 

            $('#macro_table tbody').on('click', 'td', function () {
                var td = $(this);
                var tr = td.closest('tr');
                var row = macro_table.row(tr);
                var cell = macro_table.cell(td);
                var macro = row.data();
                var col = cell.index().column;
                var key = col_idx[col];
                var ids = macro_table.columns(1).data().toArray()[0];
                var error_message = null;

                if(td.hasClass('editable')) {
                    var saved_text = td.text();
                    td.attr('contenteditable', true);
                    td.focus();
                    td.selectText();
                    
                    function save() {
                        var update = {};
                        var ok_to_update = true;
                        if(key === 'index') {
                            try {
                                v = parseInt(td.text())
                                update[key] = v;
                                if(ids.indexOf(v) != -1) {
                                    ok_to_update = false;
                                    error_message = "Macro number " + v + " already exists."
                                }
                            } catch(e) {
                                ok_to_update = false;
                            }
                        } else {
                            update[key] = td.text();
                        }
                        if(ok_to_update) {
                            fabmo.updateMacro(parseInt(macro.index), update, function(err, result) {
                                macro_table.ajax.reload();
                            });                                    
                        } else {
                            td.text(saved_text);                                    
                            if(error_message) {
                                fabmo.notify('error', error_message);
                            }
                        }
                    }

                    td.on('keydown', function(evt) {
                        switch(evt.which) {
                            case 09:
                            case 13: // Enter
                                td.off('keydown'); 
                                td.blur();
                                evt.preventDefault();
                                break;
                            case 27: // Esc
                                td.text(saved_text)
                                td.blur();
                                break;
                        }
                    });

                    td.on('blur', function(evt) {
                        td.off('blur');
                        save();
                    });

                }
            } );


            $('#macro_table tbody').on( 'click', 'td', function () {
                var tr = $(this).closest('tr');
                var row = macro_table.row( tr );
                var cell = macro_table.cell( this );
                var macro = row.data();
                switch(cell.index().column) {
                    case 0:
                        fabmo.runMacro(macro.index)
                        break;
                    case 4:
                        fabmo.launchApp('editor', {'macro' : macro.index});
                        break;
                    case 5:
                        fabmo.deleteMacro(macro.index, function(err) {
                            macro_table.ajax.reload();
                        });
                        break;
                    default:
                        break;
                }
            } );
*/
        });

