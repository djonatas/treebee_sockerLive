const express = require('express');
const app = express();
const cors = require('cors');

const spawn = require('child_process').spawn;
app.use(express.static('public'));

app.all('*', function(req, res, next) {
	next();
});

const server = require('http').createServer(app);

app.get('/api', (req, res) => {
	res.status(200).send(`Welcome to Lucrefire API v2`)
});

const io = require('socket.io')(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"]
	}
});

//const io = require('socket.io')(server);

spawn('ffmpeg',['-h']).on('error',function(m){
	console.error("FFMpeg not found in system cli; please install ffmpeg properly or make a softlink to ./!");
	process.exit(-1);
});

io.on('connection', function(socket){
	console.log('new connection', socket.id);

	try {
		socket.emit('message','Hello from mediarecorder-to-rtmp server!');
		socket.emit('message','Please set rtmp destination before start streaming.');

		socket.on('error',function(e){
			console.log('socket.io error:'+e);
		});

		socket.on('ping',function() {
			console.log('ping');
			socket.emit('message','Please set rtmp destination before start streaming.');
		});

	} catch (e) {
		console.log(e.message, e);
	}
	console.log('Chegou aqui');



	let ffmpeg_process, feedStream=false;
	socket.on('config_rtmpDestination',function(m){

		console.log('config_rtmpDestination', m);

		if(typeof m != 'string'){
			socket.emit('fatal','rtmp destination setup error.');
			return;
		}
		const regexValidator = /^rtmp:\/\/[^\s]*$/;//TODO: should read config
		if(!regexValidator.test(m)){
			socket.emit('fatal','rtmp address rejected.');
			return;
		}
		socket._rtmpDestination=m;
		socket.emit('message','rtmp destination set to:'+m);
	});
	//socket._vcodec='libvpx';//from firefox default encoder
	socket.on('config_vcodec',function(m){
		if(typeof m != 'string'){
			socket.emit('fatal','input codec setup error.');
			return;
		}
		if(!/^[0-9a-z]{2,}$/.test(m)){
			socket.emit('fatal','input codec contains illegal character?.');
			return;
		}//for safety
		socket._vcodec=m;
	});


	socket.on('start',function(m){
		if(ffmpeg_process || feedStream){

			socket.emit('fatal','stream already started.');
			return;
		}
		if(!socket._rtmpDestination){
			socket.emit('fatal','no destination given.');
			return;
		}

		const framerate = socket.handshake.query.framespersecond;
		const audioBitrate = parseInt(socket.handshake.query.audioBitrate);
		let audioEncoding = "64k";
		if (audioBitrate === 11025){
			audioEncoding = "11k";
		} else if (audioBitrate === 22050){
			audioEncoding = "22k";
		} else if (audioBitrate === 44100){
			audioEncoding = "44k";
		}
		console.log(audioEncoding, audioBitrate);
		console.log('framerate on node side', framerate);
		let ops = [];
		if (framerate === 1){
			ops = [
				'-i','-',
				'-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
				'-r', '1', '-g', '2', '-keyint_min','2',
				'-x264opts', 'keyint=2', '-crf', '25', '-pix_fmt', 'yuv420p',
				'-profile:v', 'baseline', '-level', '3',
				'-c:a', 'aac', '-b:a', audioEncoding, '-ar', audioBitrate,
				'-f', 'flv', socket._rtmpDestination
			];

		} else if (framerate === 15){
			ops = [
				'-i','-',
				'-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
				'-max_muxing_queue_size', '1000',
				'-bufsize', '5000',
				'-r', '15', '-g', '30', '-keyint_min','30',
				'-x264opts', 'keyint=30', '-crf', '25', '-pix_fmt', 'yuv420p',
				'-profile:v', 'baseline', '-level', '3',
				'-c:a', 'aac', '-b:a',audioEncoding, '-ar', audioBitrate,
				'-f', 'flv', socket._rtmpDestination
			];

		} else {
			ops=[
				'-i','-',
				'-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',  // video codec config: low latency, adaptive bitrate
				'-c:a', 'aac', '-ar', audioBitrate, '-b:a', audioEncoding, // audio codec config: sampling frequency (11025, 22050, 44100), bitrate 64 kbits
				'-bufsize', '5000',

				'-f', 'flv', socket._rtmpDestination
			];
		}
		console.log("ops", ops);
		console.log('_rtmpDestination', socket._rtmpDestination);
		ffmpeg_process=spawn('ffmpeg', ops);
		console.log("ffmpeg spawned");
		feedStream = function(data){
			ffmpeg_process.stdin.write(data);
		}

		ffmpeg_process.stderr.on('data',function(d){
			socket.emit('ffmpeg_stderr',''+d);
		});
		ffmpeg_process.on('error',function(e){
			console.log('child process error'+e);
			socket.emit('fatal','ffmpeg error!'+e);
			feedStream=false;
			socket.disconnect();
		});
		ffmpeg_process.on('exit',function(e){
			console.log('child process exit'+e);
			socket.emit('fatal','ffmpeg exit!'+e);
			socket.disconnect();
		});

		console.log('configurado com sucesso');
	});

	socket.on('binarystream',function(m){
		if(!feedStream){
			socket.emit('fatal','rtmp not set yet.');
			ffmpeg_process.stdin.end();
			ffmpeg_process.kill('SIGINT');
			console.log(m);
			console.log('nao transmitido');
			return;
		}
		feedStream(m);
	});
	socket.on('disconnect', function () {
		console.log("socket disconnected!");
		feedStream=false;
		if(ffmpeg_process)
			try{
				ffmpeg_process.stdin.end();
				ffmpeg_process.kill('SIGINT');
			}catch(e){console.warn('killing ffmoeg process attempt failed...');}
	});
	socket.on('error',function(e){
		console.log('socket.io error:'+e);
	});
});

io.on('error',function(e){
	console.log('socket.io error:'+e);
});

server.listen(process.env.PORT || 1437, function(){
	console.log('https and websocket listening on *:1437');
});

process.on('uncaughtException', function(err) {
	console.log(err)
})
