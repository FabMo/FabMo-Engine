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
	
        gcode = 'G01 X0 Y0 F50000\nG02 I100 F5000000\n'
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
