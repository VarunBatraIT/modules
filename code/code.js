const Fs = require('fs');
const Path = require('path');
const SKIP = /\/\.git\//;
const VERSION = 1;

var DDOS = {};

exports.install = function(options) {

	var url = CONF.code_url;

	if (options && options.url)
		url = options.url;

	if (!url)
		url = '/$code/';

	DEBUG && ROUTE('POST ' + url + ' *CodeModule --> exec', [1000], 1024 * 5); // Max. 5 MB
};

DEBUG && NEWSCHEMA('CodeModule', function(schema) {

	schema.define('TYPE', String, true);
	schema.define('path', String);
	schema.define('data', String);

	schema.addWorkflow('exec', function($, model) {

		if (DDOS[$.ip] > 5) {
			$.invalid('errork-token', 'Invalid token');
			return;
		}

		if (CONF.code_token && $.headers['x-token'] !== CONF.code_token) {
			DDOS[$.ip] = (DDOS[$.ip] || 0) + 1;
			$.invalid('errork-token', 'Invalid token');
			return;
		}

		switch (model.TYPE) {

			case 'ping':
				$.success(VERSION);
				break;

			// Browse files
			case 'browse':
				browse($, model);
				break;

			// Download
			case 'download':
				download($, model);
				break;

			// Creates file/directory
			case 'create':
				create($, model);
				break;

			// Loads file
			case 'load':
				load($, model);
				break;

			// Saves file
			case 'save':
				save($, model);
				break;

			// Removes file
			case 'remove':
				remove($, model);
				break;

			// Modifies file
			case 'modify':
				modify($, model);
				break;

			// Reads info about the file
			case 'info':
				info($, model);
				break;

			// Reads log file
			case 'log':
				log($, model);
				break;

			case 'rename':
				rename($, model);
				break;

			case 'upload':
				upload($, model);
				break;

			// Clears log
			case 'logclear':
				clearlog($, model);
				break;

			case 'wiki':
				wiki($, model);
				break;

			case 'ip':
				ipaddress($, model);
				break;

			default:
				$.invalid(400);
				break;
		}

	});

});

function mkdir(path, callback) {
	var a = '/';
	path = path.split('/').trim();
	path.wait(function(p, next) {
		a = a + p + '/';
		Fs.lstat(a, function(err) {
			if (err)
				Fs.mkdir(a, next);
			else
				next();
		});
	}, callback);
}

function browse($, model) {
	var path = PATH.root();
	var m = model.data.parseJSON() || EMPTYARRAY;
	var skip = m.skip ? new RegExp(m.skip) : null;
	var validator;

	if (m.type === 'localization')
		validator = ((path, dir) => dir ? (path.endsWith('/node_modules') || path.endsWith('/tmp') || path.endsWith('/.git') || path.endsWith('/.src') || path.endsWith('/logs')) ? false : true : true);
	else
		validator = n => !SKIP.test(n) && (!skip || !skip.test(n));

	U.ls(path, function(files, directories) {

		for (var i = 0; i < files.length; i++)
			files[i] = files[i].substring(path.length);

		for (var i = 0; i < directories.length; i++)
			directories[i] = directories[i].substring(path.length);

		if (m.type === 'localization') {
			var allowed = { html: 1, js: 1 };
			files = files.remove(n => allowed[U.getExtension(n)] != 1);
		}

		$.callback({ files: files, directories: directories });

	}, validator);
}

function log($, model) {
	var filename = PATH.root(model.path);
	Fs.stat(filename, function(err, stats) {
		if (stats) {
			var start = stats.size - (1024 * 4); // Max. 4 kB
			if (start < 0)
				start = 0;
			var buffer = [];
			Fs.createReadStream(filename, { start: start < 0 ? 0 : start }).on('data', chunk => buffer.push(chunk)).on('end', function() {
				var buf = Buffer.concat(buffer);
				$.controller.plain(buf.toString('utf8'));
				$.cancel();
			});
		} else {
			$.controller.plain('');
			$.cancel();
		}
	});
}

function clearlog($, model) {
	var filename = PATH.root(model.path);
	Fs.truncate(filename, NOOP);
	$.success();
}

function load($, model) {
	var filename = PATH.root(model.path);
	Fs.readFile(filename, function(err, data) {

		if (err) {
			$.invalid(err);
			return;
		}

		var index = -1;

		while (true) {
			index += 1;
			if (data.length <= index || data[index] !== 0)
				break;
		}

		if (index !== -1)
			data = data.slice(index);

		$.controller.binary(data, U.getContentType(U.getExtension(model.path)));
		$.cancel();
	});
}

function save($, model) {

	// Tries to create a folder
	var filename = PATH.root(model.path);
	var name = U.getName(model.path);
	var directory = filename.substring(0, filename.length - name.length);

	Fs.mkdir(directory, { recursive: true }, function() {
		Fs.writeFile(filename, model.data, $.done());
	});
}

function remove($, model) {

	// A simple protection for this module
	if (model.path.lastIndexOf('modules/code.js') === -1) {
		var filename = PATH.root(model.path);
		try {
			var stats = Fs.lstatSync(filename);
			if (stats.isFile()) {
				Fs.unlink(filename, NOOP);
			} else {
				if (stats.isDirectory())
					F.path.rmdir(filename);
				else
					Fs.unlink(filename, NOOP);
			}
		} catch (e) {}
	}

	$.success();
}

function info($, model) {
	var filename = PATH.root(model.path);
	Fs.lstat(filename, $.callback);
}

function download($, model) {
	var filename = PATH.root(model.path);
	var ext = U.getExtension(model.path);
	Fs.lstat(filename, function(err, stats) {
		if (err || stats.isDirectory() || stats.isSocket()) {
			$.status = 400;
			$.invalid('400', 'error-file');
		} else {
			$.controller.stream(U.getContentType(ext), Fs.createReadStream(filename));
			$.cancel();
		}
	});
}

function rename($, model) {
	var data = CONVERT(model.data.parseJSON(), 'newpath:String,oldpath:String');
	data.newpath = PATH.root(data.newpath);
	data.oldpath = PATH.root(data.oldpath);
	mkdir(Path.dirname(data.newpath), function() {
		Fs.rename(data.oldpath, data.newpath, $.done());
	});
}

function create($, model) {

	var filename = PATH.root(model.path);
	var data = model.data.parseJSON();

	Fs.lstat(filename, function(err) {

		if (err) {
			// file not found
			// we can continue
			if (data.folder) {
				mkdir(filename, $.done());
			} else {
				var name = U.getName(filename);
				mkdir(filename.substring(0, filename.length - name.length), function() {
					if (data.clone)
						Fs.copyFile(PATH.root(data.clone), filename, $.done());
					else
						Fs.writeFile(filename, '', $.done());
				});
			}
		} else
			$.invalid('path', model.path + ' already exists');
	});
}

function upload($, model) {
	var name = U.getName(model.path);
	var filename = PATH.root(model.path);
	var directory = PATH.root(model.path.substring(0, model.length - name.length));
	mkdir(directory, function() {
		var buf = Buffer.from(model.data, 'base64');
		Fs.writeFile(filename, buf, $.done());
	});
}

function modify($, model) {
	var filename = PATH.root(model.path);
	var dt = new Date();
	Fs.utimes(filename, dt, dt, NOOP);
	$.success();
}

function wiki($) {

	var path = PATH.root();

	U.ls(path, function(files) {

		var builder = [];

		files.wait(function(item, next) {

			if (item.substring(item.length - 3) === '.js') {
				Fs.readFile(item, function(err, buffer) {
					if (buffer) {
						builder.push(buffer.toString('utf8'));
						builder.push('');
					}
					next();
				});
			} else
				next();

		}, function() {
			$.controller.plain(builder.join('\n'));
			$.cancel();
		});

	}, path => (/schemas|controllers/).test(path));

}

function ipaddress($) {
	var opt = {};
	opt.url = 'https://ipecho.net/plain';
	opt.callback = function(err, response) {
		$.controller.plain(response.body || 'undefined');
		$.cancel();
	};
	REQUEST(opt);
}

DEBUG && ON('service', function(counter) {
	if (counter % 20 === 0)
		DDOS = {};
});