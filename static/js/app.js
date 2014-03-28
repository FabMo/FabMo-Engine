App = Ember.Application.create();
//App.ApplicationAdapter = DS.FixtureAdapter.extend();

App.Router.map(function() {
    this.resource('tools');
});

App.Tool = DS.Model.extend({
    name : DS.attr('string'),
    xpos : DS.attr('number'),
    ypos : DS.attr('number'),
    zpos : DS.attr('number'),
    status : DS.attr('string'),
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
