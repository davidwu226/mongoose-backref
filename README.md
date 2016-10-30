
This is a Mongoose plugin that handles back references. You can
define a back reference on any references or array of references
in the source Schema. Whenever the a document of the source Schema
type has that field changed, the target document will have its
back references updated:

Foo {bar: {ref: 'Bar', backref: 'foos'}}
Bar {foos: [{ref: 'Foo'}]}

In the above, anytime Foo.bar is changed, the related Bar.foos is
updated. Note that this is not bi-directional! If Bar.foos is changed,
Foo.bar is NOT updated. In order to do that, you need to define a
reverse back reference:

Foo {bar: {ref: 'Bar', backref: 'foos'}}
Bar {foos: [{ref: "Foo', backref: 'bar'}]}

In the above, any updates to Foo.bar is same as before, but in addition,
any changes to Bar.foos get updated too (in this case, if a Foo is
removed from Bar.foos, that Foo's Foo.bar will be set to null). Note
that in this particular instance, you want to really make sure this
is the right behavior for your model relationship. For example,
as defined above, one could add the same Foo to multiple Bar.foos, in
which case the last Bar that added Foo would have it referenced in
Foo.bar. In order to deal with this, you might want to have a many-to-many
relationship:

Foo {bars: [{ref: 'Bar', backref: 'foos'}]}
Bar {foos: [{ref: "Foo', backref: 'bars'}]}

In this case, Foo.bars is an array of references, so many-to-many
relationships are supported.

