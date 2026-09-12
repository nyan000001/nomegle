const app = require('express')();
const server = require('http').createServer(app);
const io = require('socket.io')(server, { connectionStateRecovery:{ maxDisconnectionDuration:1800000, skipMiddlewares:true } });
const { randomBytes } = require('crypto');
const rooms = new Map();
app.get('/',  (req, res) => res.sendFile(__dirname+'/index.html'));
app.get('/:room',  (req, res) => res.sendFile(__dirname+'/index.html'));
io.on('connection', socket => {
	const getopenrooms = () => [...rooms].filter(([roomid, room]) => room.socketids);
	if(socket.recovered) {
		clearTimeout(socket.data.timeout);
		const side = socket.data.side;
		if(side && room.socketcounts[side] == 1) {
			io.to(socket.data.roomid).emit('online', side);
		}
	} else {
		socket.emit('rooms', getopenrooms().map(([roomid, room]) => [roomid, room.messages[0][0]]));
	}
	const leave = () => {
		const roomid = socket.data.roomid;
		if(!roomid) return;
		socket.leave(roomid);
		const room = rooms.get(roomid);
		const side = socket.data.side;
		room.socketcounts[side]--;
		if(room.socketids) {
			if(side) { // stranger 1
				room.socketids.pop();
			} else { // spy
				room.socketids[0] = null;
			}
			setTimeout(() => {
				if(room.socketcounts.every(count => count == 0)) {
					io.emit('remove', roomid);
					rooms.delete(roomid);
				}
			}, Math.random()*5000+1000);
		} else if(side && room.socketcounts[side] == 0) {
			const message = 'Stranger '+side+' has disconnected';
			io.to(roomid).emit('message', message, null);
			room.messages.push([message]);
		}
		delete socket.data.roomid;
		delete socket.data.side;
	};
	socket.on('skip', () => leave());
	socket.on('disconnect', reason => {
		if(reason.includes('disconnect')) {
			leave();
		} else {
			const side = socket.data.side;
			if(side && room.socketcounts[side] == 1) {
				io.to(socket.data.roomid).emit('offline', side);
			}
			socket.data.timeout = setTimeout(() => {
				socket.disconnect();
				leave();
			}, 1800000);
		}
	});
	const join = roomid => {
		socket.join(roomid);
		socket.data.roomid = roomid;
		const room = rooms.get(roomid);
		if(room.socketids) { // new room
			socket.data.side = room.socketids.length;
			room.socketids.push(socket.id);
		}
		room.socketcounts[socket.data.side]++;
	};
	const rand = arr => arr[Math.random*arr.length|0];
	const createroom = question => {
		question ??= rand([...rooms.values()])?.messages[0][0] ?? 'what brings you here?';
		do var roomid = randomBytes(10).toString('hex');
		while(rooms.has(roomid));
		rooms.set(roomid, { socketids:[], socketcounts:[0, 0, 0], messages:[[question, 0]], time:Date.now() });
		io.emit('add', roomid, question);
		return roomid;
	};
	socket.on('ask', question => {
		leave();
		const roomid = createroom(question);
		join(roomid);
	});
	socket.on('join', (roomid, userid) => {
		leave();
		roomid ||= rand(getopenrooms().map(([roomid]) => roomid)) ?? createroom();
		const room = rooms.get(roomid);
		if(!room) { // expired?
			socket.emit('notfound');
			return;
		}
		if(room.socketids) {
			if(!room.socketids.length) {
				room.socketids.push(null);
			}
			join(roomid);
			if(room.socketids.length == 3) {
				const userids = new Set();
				do userids.add(randomBytes(10).toString('hex'));
				while(userids.size < 3);
				room.userids = [...userids];
				for(let i = 0; i < 3; i++) {
					io.to(room.socketids[i]).emit('join', roomid, room.messages, room.userids[i], i);
				}
				delete room.socketids;
				io.emit('remove', roomid);
			}
		} else { // rejoin
			const side = socket.data.side = room.userids.lastIndexOf(userid);
			if(side == -1) {
				socket.emit('full');
				return;
			};
			join(roomid);
			socket.emit('join', roomid, room.messages, userid, side);
			if(side && rooms.get(roomid).socketcounts[side] == 1) {
				const message = 'Stranger '+side+' has reconnected';
				io.to(roomid).emit('message', message, null);
				room.messages = room.messages.filter(message => message[0] != 'Stranger '+side+' has disconnected' && message[0] != 'Stranger '+side+' has reconnected');
				room.messages.push([message]);
			}
			return;
		}
	});
	socket.on('message', message => {
		const side = socket.data.side;
		if(!side) return;
		const roomid = socket.data.roomid;
		if(!roomid) return;
		const room = rooms.get(roomid);
		if(!room) return;
		io.to(roomid).emit('message', message, side);
		room.messages.push([message, side]);
		room.time = Date.now();
	});
	const time = Date.now()-86400000;
	for(const [roomid, room] of rooms) {
		if(room.time < time) {
			rooms.delete(roomid);
		}
	}
});
server.listen(8080);
