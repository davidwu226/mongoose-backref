var co = require('co');
var mongoose = require('mongoose');
var backref = require('../index');
var Schema = mongoose.Schema;
var ObjectId = Schema.Types.ObjectId;

mongoose.Promise = global.Promise;
mongoose.connect('mongodb://192.168.99.100:27017/mongoose_backref_test');
mongoose.plugin(backref);

co(test());

function *test() {
  var FooSchema = new Schema({
    data: String,
    bar: {type: ObjectId, ref: 'Bar', backref: 'foos'},
    bazs: [{type: ObjectId, ref: 'Baz', backref: 'foos'}],
    ignored: [{type: ObjectId, ref: 'Baz'}]
  });
  
  var BarSchema = new Schema({
    data: String,
    foos: [{type: ObjectId, ref:'Foo'}]
  });
  
  var BazSchema = new Schema({
    data: String,
    foos: [{type: ObjectId, ref:'Foo', backref: 'bazs'}]
  });
  
  var Foo = mongoose.model('Foo', FooSchema);
  var Bar = mongoose.model('Bar', BarSchema);
  var Baz = mongoose.model('Baz', BazSchema);
  
  yield Foo.remove({});
  yield Bar.remove({});
  yield Baz.remove({});

  var bar1 = new Bar({data: 'bar1'}); 
  var foo1 = new Foo({data: 'foo1'});
  var foo2 = new Foo({data: 'foo2'});
  var baz1 = new Baz({data: 'baz1'});
  var baz2 = new Baz({data: 'baz2'});
  var baz3 = new Baz({data: 'baz3'});

  foo1.bazs = [baz1];

  yield bar1.save();
  yield baz1.save();
  yield baz2.save();
  yield baz3.save();
  yield foo1.save();
  
  var find = yield Foo.findOne({});

  find.bazs = [baz1, baz2];
  yield find.save();

  find.bazs = [baz1];
  yield find.save();

  foo2.bar = bar1;
  yield foo2.save();

  foo2.bar = undefined;
  yield foo2.save();

  foo2.bar = bar1;
  yield foo2.save();

  find.bazs = [baz2, baz3];
  yield find.save();
}
