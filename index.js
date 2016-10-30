"use strict";

var mongoose = require('mongoose');

//
// This is a Mongoose plugin that handles back references. You can
// define a back reference on any references or array of references
// in the source Schema. Whenever the a document of the source Schema
// type has that field changed, the target document will have its
// back references updated:
//
// Foo {bar: {ref: 'Bar', backref: 'foos'}}
// Bar {foos: [{ref: 'Foo'}]}
//
// In the above, anytime Foo.bar is changed, the related Bar.foos is
// updated. Note that this is not bi-directional! If Bar.foos is changed,
// Foo.bar is NOT updated. In order to do that, you need to define a
// reverse back reference:
//
// Foo {bar: {ref: 'Bar', backref: 'foos'}}
// Bar {foos: [{ref: "Foo', backref: 'bar'}]}
//
// In the above, any updates to Foo.bar is same as before, but in addition,
// any changes to Bar.foos get updated too (in this case, if a Foo is
// removed from Bar.foos, that Foo's Foo.bar will be set to null). Note
// that in this particular instance, you want to really make sure this
// is the right behavior for your model relationship. For example,
// as defined above, one could add the same Foo to multiple Bar.foos, in
// which case the last Bar that added Foo would have it referenced in
// Foo.bar. In order to deal with this, you might want to have a many-to-many
// relationship:
//
// Foo {bars: [{ref: 'Bar', backref: 'foos'}]}
// Bar {foos: [{ref: "Foo', backref: 'bars'}]}
//
// In this case, Foo.bars is an array of references, so many-to-many
// relationships are supported.
//
module.exports = exports = function backrefPlugin(schema, options) {

  var has_backref = false;
  
  // Iterate through each path and check if we should add references.
  schema.eachPath((name, type) => { 
    if ('options' in type) {
      if ('backref' in type.options) {

        // Handle the case where source path is an ObjectID.        
        has_backref = true;
        
        let src_path = name;
        let dst_model = type.options.ref;
        let dst_path = type.options.backref;

        // Add a set hook which records changes to the path.
        schema.post('init',
                    postinit(src_path, dst_model, dst_path));
        
        // Add a pre hook which determine the list of changes to make.
        schema.pre('save',
                   presave(false, src_path, dst_model, dst_path));
        
        // Add a post save hook to reset the original values to the saved values.
        schema.post('save',
                    postsave_originals(false, src_path, dst_model, dst_path));
      } else if (('Array' == type.instance) && ('type' in type.options)
                 && ('backref' in type.options.type[0])) {
        
        // Handle the case where source path is an Array of ObjectIDs.
        has_backref = true;
        
        let src_path = name;
        let dst_model = type.options.type[0].ref;
        let dst_path = type.options.type[0].backref;

        // Add a set hook which records changes to the path.
        schema.post('init',
                    postinit(src_path, dst_model, dst_path));

        // Add a pre hook which determine the list of changes to make.
        schema.pre('save',
                   presave(true, src_path, dst_model, dst_path));
        
        // Add a post save hook to reset the original values to the saved values.
        schema.post('save',
                    postsave_originals(false, src_path, dst_model, dst_path));
      }
    }    
  });

  if (has_backref) {    
    schema.pre('init', preinit());
    schema.post('save', postsave());
  }
};

//
// This hook is called when a document is initialized from an existing
// document in the database (however, creating a new document does NOT
// fire this hook!) This creates the metadata for tracking.
//
// This is called only once per document.
//
function preinit() {
  return function(next) {    
    // Original values of back referenced paths.
    this._backref_originals = {};
    next();
  };
}

//
// This hook is called when a document is initialized from an existing
// document in the database (however, creating a new document does NOT
// fire this hook!)
//
// It is called once every back referenced path of a document, so
// a document may have this called multiple times if it has multiple
// paths that are back referenced.
//
function postinit(src_path, dst_model, dst_path) {
  return function() {
    // Save the original values.
    if (this[src_path] != undefined) {
      this._backref_originals[src_path] = flatten_to_id(this[src_path]);
    }
  };
}

//
// This hook is called when a document is about to be saved. It prepares
// the updates to be made after the save is completed.
//
// It is called once every back referenced path of a Schema, so a
// document.save() may cause multiple calls if it has multiple
// paths that have back references.
//
function presave(is_array, src_path, dst_model, dst_path) {
  return function(next) {
    if (!('_backref_originals' in this)) {
      // In this case, the document has no metadata, so we know
      // the document is completely new. In this case, all of the
      // paths would be treated as new additions.
      if (this[src_path] != undefined) {
        add_backref(this, this[src_path], dst_model, dst_path);
      }
    } else {
      // In this case, compute the delta between saved values
      // and original values.
      let orig = flatten_to_id(this._backref_originals[src_path]);
      let saved = flatten_to_id(this[src_path]);

      if (!is_array) {
        if (saved != orig) {
          if (saved) {
            add_backref(this, saved, dst_model, dst_path);
          }
          if (orig) {
            remove_backref(this, orig, dst_model, dst_path);
          }
        }
      } else {
        let added = saved.filter(x => orig.indexOf(x) == -1);
        let removed = orig.filter(x => saved.indexOf(x) == -1);

        if (added && added.length > 0) {
          add_backref(this, added, dst_model, dst_path);
        }
        if (removed && removed.length > 0) {
          remove_backref(this, removed, dst_model, dst_path);
        }
      }
    }    

    next();
  };
}

function postsave() {
  return function(doc) {
    if ('_backref_changes' in this) {
      for (let model_name in this._backref_changes) {
        let model = mongoose.model(model_name);
        for (let id in this._backref_changes[model_name]) {
          let update = this._backref_changes[model_name][id];
          console.log("updating: "+model_name+" "+id+" "+JSON.stringify(update));
          let query = model.findOneAndUpdate({_id: new mongoose.Types.ObjectId(id)}, update,
                                             function(err, backref_doc) {
                                               if (err) {
                                                 throw new Error("Error during backref update: "+err);
                                               } else if (backref_doc == null) {
                                                 throw new Error("Error during backref update: query found no document");
                                               }
                                             });
        }
      }
      delete this._backref_changes;
    }
  };
}

function postsave_originals(is_array, src_path, dst_model, dst_path) {
  return function(doc, next) {
    if (!('_backref_originals' in this)) {
      this._backref_originals = {};
    }

    // Save the original values.
    delete this._backref_originals[src_path];
    if (this[src_path] != undefined) {
      this._backref_originals[src_path] = flatten_to_id(this[src_path]);
    }

    next();
  };
};

function update_backref_changes(type, doc, dst_ids, dst_model, dst_path) {

  let model = mongoose.model(dst_model);
  let schema = model.schema;
  
  // First, ensure _backref_changes.dst_model metadata exists.
  // If not, create them.
  if (!('_backref_changes' in doc)) {
    doc._backref_changes = {};
  }

  if (!(dst_model in doc._backref_changes)) {
    doc._backref_changes[dst_model] = {};
  }

  if (!(Array.isArray(dst_ids))) {
    dst_ids = [dst_ids];
  }

  for (let id of dst_ids) {
    id = flatten_to_id(id);
    
    if (!(id in doc._backref_changes[dst_model])) {
      doc._backref_changes[dst_model][id] = {};
    }
    
    if (schema.paths[dst_path].instance == 'Array') {
      if (type == 'add') {
        if (!('$addToSet' in doc._backref_changes[dst_model][id])) {
          doc._backref_changes[dst_model][id]['$addToSet'] = {};
        }
        doc._backref_changes[dst_model][id]['$addToSet'][dst_path] = doc._id;
      } else {
        if (!('$pullAll' in doc._backref_changes[dst_model][id])) {
          doc._backref_changes[dst_model][id]['$pullAll'] = {};
        }
        doc._backref_changes[dst_model][id]['$pullAll'][dst_path] = [doc._id];
      }
    } else {
      if (type == 'add') {
        if (!('$set' in doc._backref_changes[dst_model][id])) {
          doc._backref_changes[dst_model][id]['$set'] = {};
        }
        doc._backref_changes[dst_model][id]['$set'][dst_path] = doc._id;
      } else {
        if (!('$unset' in doc._backref_changes[dst_model][id])) {
          doc._backref_changes[dst_model][id]['$unset'] = {};
        }
        doc._backref_changes[dst_model][id]['$unset'][dst_path] = doc._id;
      }
    }
  }
}

function add_backref(doc, dst_ids, dst_model, dst_path) {
  update_backref_changes('add', doc, dst_ids, dst_model, dst_path);
}

function remove_backref(doc, dst_ids, dst_model, dst_path) {
  update_backref_changes('remove', doc, dst_ids, dst_model, dst_path);
}

//
// Ensures that we have ObjectIDs as Strings.
// Handles both elements and arrays.
//
function flatten_to_id(ids) {
  var res = ids; // already string or undefined.
  
  if (Array.isArray(ids)) {
    res = [];
    for (let id of ids) {
      if ((typeof(id) == 'object') && ('_id' in id)) {
        res.push(""+id._id);
      } else {
        res.push(""+id);
      }
    }
  } else if (typeof(ids) == 'object') {
      if ('_id' in ids) {
        res = ""+ids._id;
      } else {
        res = ""+ids;
      }
  }
  
  return res;
}
