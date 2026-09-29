require('jquery');
var Foundation = require('../../../static/js/libs/foundation.min.js');;
var Fabmo = require('../../../static/js/libs/fabmo.js');
require('./i18n.js');   // installs window.t / window.i18nReady / window.i18nApply
var fabmo = new Fabmo;

var macroIndex = {};
var statusIndex = {};   // index -> status entry from /macros/status

// Pill appearance / detail copy per status state. States not listed
// ("custom" = user's own macro, "ignored_default") get no pill.
var STATUS_UI = {
    current: {
        pillClass: 'current',
        pillKey: 'macro_manager.status.pill_current',
        tipKey: 'macro_manager.status.tip_current'
        // no detail row, no actions
    },
    customized: {
        pillClass: 'customized',
        pillKey: 'macro_manager.status.pill_customized',
        detailKey: 'macro_manager.status.detail_customized',
        actions: [{ act: 'install', labelKey: 'macro_manager.actions.revert', style: 'danger' }]
    },
    update_available: {
        pillClass: 'update',
        pillKey: 'macro_manager.status.pill_update',
        detailKey: 'macro_manager.status.detail_update',
        actions: [
            { act: 'install', labelKey: 'macro_manager.actions.update', style: 'primary' },
            { act: 'dismiss', labelKey: 'macro_manager.actions.keep' }
        ]
    },
    diverged: {
        pillClass: 'diverged',
        pillKey: 'macro_manager.status.pill_diverged',
        detailKey: 'macro_manager.status.detail_diverged',
        actions: [
            { act: 'install', labelKey: 'macro_manager.actions.replace', style: 'danger' },
            { act: 'dismiss', labelKey: 'macro_manager.actions.keep' }
        ]
    },
    new_default: {
        pillClass: 'new',
        pillKey: 'macro_manager.status.pill_new',
        detailKey: 'macro_manager.status.detail_new',
        actions: [
            { act: 'install', labelKey: 'macro_manager.actions.install', style: 'primary' },
            { act: 'dismiss', labelKey: 'macro_manager.actions.ignore' }
        ]
    }
};

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

function statusCellContent(entry) {
    if (!entry) return '';
    var ui = STATUS_UI[entry.state];
    if (!ui) return '';
    var tip = ui.tipKey ? window.t(ui.tipKey) : (ui.detailKey ? window.t(ui.detailKey) : '');
    var clickable = ui.actions ? ' clickable' : '';
    return '<span class="status-pill ' + ui.pillClass + clickable + '" title="' + tip.replace(/"/g, '&quot;') + '">' +
        window.t(ui.pillKey) + '</span>';
}

// Toggle the detail/action row directly beneath the macro's row.
function toggleDetailRow(tr, entry) {
    var ui = STATUS_UI[entry.state];
    if (!ui || !ui.actions) return;
    var existing = tr.nextElementSibling;
    var wasOpen = existing && existing.classList.contains('status-detail');
    $('#macro_table_body tr.status-detail').remove();  // one open at a time
    if (wasOpen) return;

    var detail = document.createElement('tr');
    detail.className = 'status-detail';
    var td = document.createElement('td');
    td.colSpan = 7;
    var msg = document.createElement('div');
    msg.className = 'status-detail-message';
    msg.textContent = window.t(ui.detailKey);
    td.appendChild(msg);
    var btnRow = document.createElement('div');
    btnRow.className = 'status-detail-buttons';
    ui.actions.forEach(function (action) {
        var btn = document.createElement('button');
        btn.className = 'status-action-btn' + (action.style ? ' ' + action.style : '');
        btn.textContent = window.t(action.labelKey);
        btn.addEventListener('click', function () {
            runStatusAction(action.act, entry);
        });
        btnRow.appendChild(btn);
    });
    var close = document.createElement('button');
    close.className = 'status-action-btn';
    close.textContent = window.t('macro_manager.actions.close');
    close.addEventListener('click', function () { $(detail).remove(); });
    btnRow.appendChild(close);
    td.appendChild(btnRow);
    detail.appendChild(td);
    tr.parentNode.insertBefore(detail, tr.nextSibling);
}

function runStatusAction(act, entry) {
    var url = '/macros/' + entry.index + '/' + (act === 'install' ? 'install_default' : 'dismiss_default');
    $.post(url, function (resp) {
        if (resp && resp.status === 'success') {
            if (act === 'install') {
                var name = (resp.data && resp.data.name) || ('#' + entry.index);
                fabmo.notify('success', window.t('macro_manager.notify.installed_default', { name: name }));
            } else {
                fabmo.notify('info', window.t('macro_manager.notify.dismissed_default', { index: entry.index }));
            }
        } else {
            fabmo.notify('error', (resp && resp.message) || 'Error');
        }
        refreshMacros();
    }, 'json').fail(function () {
        fabmo.notify('error', 'Could not reach the tool.');
        refreshMacros();
    });
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
        var statusCell = row.insertCell(4);
        var editCell = row.insertCell(5);
        var deleteCell = row.insertCell(6);

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

        statusCell.className = 'status-control';
        statusCell.innerHTML = statusCellContent(statusIndex[macro.index]);

        playCell.className = 'run-control';
        playCell.innerHTML = '<img class="svg" src="css/images/play_icon.png">'

        deleteCell.className = 'delete-control';
        deleteCell.innerHTML = '<img class="svg" src="css/images/recycling10.svg">'

        editCell.className = 'edit-control';
        editCell.innerHTML = '<img class="svg" src="css/images/edit_icon.png">'

    });

    // Shipped-with-profile macros that are not installed on this tool:
    // rendered as inert rows with just the status pill (install/ignore).
    Object.keys(statusIndex).map(Number).sort(function(a,b){return a-b;}).forEach(function (idx) {
        var entry = statusIndex[idx];
        if (!entry || entry.state !== 'new_default') return;
        var row = table.insertRow(table.rows.length);
        row.className = 'uninstalled-default';
        row.dataset.statusOnly = '1';
        row.dataset.macro = idx;
        row.insertCell(0);
        var numberCell = row.insertCell(1);
        var nameCell = row.insertCell(2);
        var descriptionCell = row.insertCell(3);
        var statusCell = row.insertCell(4);
        row.insertCell(5);
        row.insertCell(6);
        numberCell.className = 'number';
        numberCell.textContent = idx;
        nameCell.className = 'name';
        nameCell.textContent = entry.name || '';
        descriptionCell.className = 'description';
        descriptionCell.textContent = entry.description || '';
        statusCell.className = 'status-control';
        statusCell.innerHTML = statusCellContent(entry);
    });

    $('.run-control').click(function(evt) {
        var macro = getMacroFromClick(this);
        if (!macro) return;
        fabmo.runMacro(macro.index, function(err, data) {
            if(err) {
                fabmo.notify('error', err.message || err);
            }
            refreshMacros();
        });
    });

    $('.delete-control').click(function(evt) {
        var macro = getMacroFromClick(this);
        if (!macro) return;
        fabmo.deleteMacro(macro.index, function(err, data) {
            if(err) {
                fabmo.notify('error', err.message || err);
            } else {
                fabmo.notify('success', window.t('macro_manager.notify.deleted', {name: macro.name}));
            }
            refreshMacros();
        });
    });

    $('.edit-control').click(function(evt) {
        var macro = getMacroFromClick(this);
        if (!macro) return;
        fabmo.launchApp('editor', {'macro' : macro.index});
    });

    $('.status-pill.clickable').click(function(evt) {
        var tr = $(this).closest('tr')[0];
        var entry = statusIndex[$(tr).data('macro')];
        if (entry) toggleDetailRow(tr, entry);
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

function refreshStatus(callback) {
    $.getJSON('/macros/status', function (resp) {
        statusIndex = {};
        if (resp && resp.status === 'success' && resp.data && resp.data.macros) {
            resp.data.macros.forEach(function (entry) {
                statusIndex[entry.index] = entry;
            });
        }
        callback(null);
    }).fail(function () {
        // Status is an enhancement -- render the plain table if it fails.
        statusIndex = {};
        callback(null);
    });
}

function refreshMacros(callback) {
    callback = callback || function() {};
    fabmo.getMacros(function(err, macros) {
        if(err) {
            return callback(err);
        }
        refreshStatus(function () {
            updateMacroIndex(macros);
            clearMacroTable();
            addMacros(macros);
            callback(null);
        });
    });
}


$(document).ready(function() {

    $(document).foundation();

    // Wait for translations so pills/details don't flash raw keys.
    (window.i18nReady || Promise.resolve()).then(function () {
        refreshMacros();
    });

    // Statuses change when a macro is edited in the editor app -- refresh
    // when the user comes back to this tab.
    window.addEventListener('focus', function () {
        refreshMacros();
    });

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
