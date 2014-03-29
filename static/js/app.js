var UPDATE_INTERVAL = 100 //ms
App = Ember.Application.create();
//App.ApplicationAdapter = DS.FixtureAdapter.extend();

App.Router.map(function() {
    this.resource('tools');
    this.resource('app');
    this.resource('about');
});

App.Tool = DS.Model.extend({
    name : DS.attr('string'),
    xpos : DS.attr('number'),
    ypos : DS.attr('number'),
    zpos : DS.attr('number'),
    status : DS.attr('string'),

    didLoad: function(){
        var self = this;
        setInterval(function() {self.reload()}, UPDATE_INTERVAL); 
    }
});

Ember.Handlebars.helper('position', function(value, options) {
  return new Handlebars.SafeString(value.toFixed(3));
});

App.AppController = Ember.ObjectController.extend({
  actions: {
    cut: function() {
        gcode = 'G0 Z0.5\nG0 X-10 Y0 F70\nG1 Z-1 F50\nG2 I10\nG0 Z0.5 F70\nG0 X0 Y0 F70\nM30\n'
        console.log('Cut button was clicked!')
        $.post( "/gcode", {'data' : gcode});
    }
  }
});

App.Tool.FIXTURES = [{
    id: 1,
    name: 'Shopbot Desktop',
    xpos: 10.3,
    ypos: 9.1,
    zpos: 1.225,
    status: 'idle'
}];

App.ToolsRoute = Ember.Route.extend({
    model: function() {
        return this.store.find('tool')
    }
});
