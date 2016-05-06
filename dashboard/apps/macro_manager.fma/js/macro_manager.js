var macroIndex = {};

function getMacroFromClick(elem) {
    var id = $(elem).closest('tr').data('macro');
    return macroIndex[id];
}

function clearMacroTable() {
    var table = document.getElementById('macro_table_body');
    var rows = table.rows.length;
    for(var i=0; i<rows; i++) {
        table.deleteRow(0);
    }
}

function addMacros(macros, callback) {
    callback = callback || function() {};
    var table = document.getElementById('macro_table_body');
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
        numberCell.innerHTML = '<input class="field" type="number" data-fieldname="index" size="3" maxlen="3"></input>';
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
            if(err) {
                fabmo.notify('error', err.message || err);
            }
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
    fabmo.getMacros(function(err, macros) {
        if(err) {
            return callback(err);
        }
        updateMacroIndex(macros);
        clearMacroTable();
        addMacros(macros);
        callback(null);
    });
}

$(document).ready(function() {

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
                fabmo.notify('error', err.message || err);                        
            }
            refreshMacros();
        });
        evt.preventDefault();
    }); 

});

