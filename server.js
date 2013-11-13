

var express = require('express');
var app = express();
var ws = require('websocket.io');
var uuid = require('node-uuid');
var ent = require('ent');

app.use(express["static"]('./public'));

app.get('/', function(req, res) {
    res.sendfile(__dirname + '/index.html');
});

var port = 3002;

var server = app.listen(port);
var io = ws.attach(server);


console.log('Server listening on port ' + port);


io.clientsWaiting || (io.clientsWaiting = []);
io.clientsInRooms || (io.clientsInRooms = 0);


io.on('connection', function(socket) {
    console.log('------------------------------------------------');
    console.log('Client connected from ' + socket.req.connection.remoteAddress);
    console.log('User Agent: ' + socket.req.headers['user-agent'] + '\n');

    var base;

    socket.id = uuid.v1();
    console.log('attributed id = ' + socket.id);

    socket.connected = false;
    socket.isReady = false;
    socket.keepAlive = false;
    socket.lastKeepAlive = 0;       // gets new time when connection ready received or when keep_alive received

    socket.destSock = null;

    socket.send(JSON.stringify({
        type: 'assigned_id',
        id: socket.id
    }));

    console.log('new client connected!');
    printId();

    return socket.on('message', function(data) {
        var msg, sock, i, ref;
        msg = JSON.parse(data);

        console.log('Received msg of type ' + msg.type + ' from ' + socket.id);

        ref = io.clientsWaiting;

        switch (msg.type) {
            case 'received_offer':
            case 'received_candidate':
            case 'received_answer':

                if (socket.isReady) {

                    if (ref.length > 1) {

                        // if we don't have a destination socket
                        //
                        if (socket.destSock == null) {
                            for (i = 0; i < ref.length; i++) {
                                if (ref[i].id !== socket.id) {
                                    socket.destSock = ref[i];
                                    break;
                                }
                            }
                            if (socket.destSock == null)           // if we didn't found a partner to chat with, it should not happen
                                console.log('partner not found, error !!!');
                        }

                    } else {
                        if (socket.destSock == null) {
                            console.log('ERROR: received answer but no one is available for chat');
                            console.log('and remote socket doesn\'t exist...');
                        }
                    }


                    if (socket.destSock != null) {
                        //console.log('Me, ' + socket.id + ' am sending a msg ' + msg.type + ' to ' + socket.destSock.id);
                        socket.destSock.send(JSON.stringify(msg));
                    } else {
                        console.log('ERROR: remote socket doesn\'t exist, message ' + msg.type + ' could not be relayed');
                    }


                } else {
                    console.log('ERROR: received ' + msg.type + ' but client was not ready!');
                }


                break;

            case 'client_ready':

                socket.isReady = true;
                socket.keepAlive = true;
                socket.lastKeepAlive = new Date().getTime();
                checkKeepAlive(socket);

                io.clientsWaiting.push(socket);

                printId();

                isPeerAvailable(socket);              // send msg of type 'peer_available' if someone is available to chat

                break;

            case 'connection_ok':

                if (socket.destSock == null) {
                    console.log('ERROR: remote socket doesn\'t exist!');
                    return;
                }

                socket.destSock.send(JSON.stringify({
                    'type': 'connection_ok'
                }));

                var toDelete = [];
                for (i = 0; i < ref.length ; i++)
                    if (ref[i].id === socket.id || ref[i].id === socket.destSock.id)
                        toDelete.push(ref[i]);

                for (i = 0; i < toDelete.length; i++)
                    ref.splice(ref.indexOf(toDelete[i]), 1);

                io.clientsInRooms += 2;

                socket.connected = true;
                socket.destSock.connected = true;

                console.log('CONNECTION OK, now ' + ref.length + ' clients waiting, ' + io.clientsInRooms + ' clients in communication.');
                printId();
                break;

            case 'next':
                if (socket.connected) {

                    var pos = ref.indexOf(socket);
                    if (pos >= 0) {
                        console.log('ERROR: client\'s socket should not be in the waiting list');             // sanity check
                        return;
                    }

                    if (socket.destSock != null) {
                        var pos = ref.indexOf(socket.destSock);
                        if (pos >= 0) {
                            console.log('ERROR: remote socket should not be in the waiting list');
                            return;
                        }
                    } else {
                        console.log('ERROR: remote socket doesn\'t exist!');
                        return;
                    }

                    socket.destSock.send(JSON.stringify({        // tell peer that he has been nexted
                        type: 'nexted'
                    }));

                    io.clientsInRooms -= 1;

                    socket.connected = false;
                    socket.destSock = null;

                } else {
                    console.log('ERROR: next done but clients were not connected');
                }

                break;

            case 'next_ack':                 // sent from the client who has been nexted

                if (socket.connected) {
                    io.clientsInRooms -= 1;

                    socket.connected = false;

                    ref.push(socket);
                    ref.push(socket.destSock);

                    socket.destSock = null;

                    isPeerAvailable(socket);

                    printId();
                } else {
                    console.log('ERROR: next_ack done but clients were not connected');
                }

                break;

            case 'chat_msg':

                if (socket.connected) {
                    if (socket.destSock != null) {
                        escaped_msg = ent.encode(msg.data);                     // protection from XSS flaws
                        socket.destSock.send(JSON.stringify({
                                type: 'chat_msg',
                                data: escaped_msg
                        }));
                        console.log('Forwarded message: ' + msg.data);
                    } else {
                        console.log('Error while forwarding chat message, socket.destSock is null');
                    }
                } else {
                    console.log('Error while forwarding chat message, socket not connected');
                }

                break;


            case 'keep_alive':
                socket.lastKeepAlive = new Date().getTime();
                break;

            case 'remote_connection_closed':

                socket.connected = false;

                socket.destSock = null;
                isPeerAvailable(socket);

                break;

            case 'close':

                console.log('Client deconnecté ! id: ' + socket.id);

                socket.keepAlive = false;

                var pos = ref.indexOf(socket);
                if (pos >= 0)
                    ref.splice(pos, 1);     // remove socket of disconnected client, if it exists


                if (socket.destSock != null) {
                    if (socket.connected) {
                        io.clientsInRooms -= 2;
                        ref.push(socket.destSock);                     // add socket of his partner to the waiting list
                        socket.destSock.send(JSON.stringify({        // tell that peer is disconnected
                            type: 'connection_closed'
                        }));
                    } else {
                        console.log('Error: close message, socket.destSock not null but socket not connected');
                    }

                    socket.destSock = null;
                }

                socket.connected = false;

                printId();

                socket.close();

                break;
        }
    });
});

//process.on('uncaughtException', function (err) {
  //  console.log('/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*');
  //  console.log('/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*');
  //  console.log('UNCAUGHT EXCEPTION');
  //  console.log(err);
  //  console.log('/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*');
  //  console.log('/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*/*');
//})


function isPeerAvailable(sock) {
    if (io.clientsWaiting.length > 1) {
        sock.send(JSON.stringify({
            type: 'peer_available'
        }));
    } else {
        console.log('isPeerAvailable(): ' + io.clientsWaiting.length + ' in wait queue, aborting...');
    }
}

// TODO un intervalle serait peut etre mieux cf setInterval
function checkKeepAlive(socket) {                 // FIXME : est ce qu'on recoit est bien la version correcte de socket.destSock et socket ou c'est tout du caca ???
    if (socket.keepAlive) {
        timeDifference = new Date().getTime() - socket.lastKeepAlive;

        console.log(socket.connected);

        if (timeDifference > 6000) {     // 6 seconds
            console.log('Client with ID ' + socket.id + ' didn\'t send keep_alive packet for ' + timeDifference + ' ms.\nDisconnecting him...');

            ref = io.clientsWaiting;

            socket.keepAlive = false;

            var pos = ref.indexOf(socket);
            if (pos >= 0)
                ref.splice(pos, 1);     // remove socket of disconnected client, if it exists

            if (socket.destSock != null) {
                if (socket.connected) {
                    io.clientsInRooms -= 2;
                    ref.push(socket.destSock);                     // add socket of his partner to the waiting list
                    socket.destSock.send(JSON.stringify({        // tell that peer is disconnected
                        type: 'connection_closed'
                    }));
                } else {
                    console.log('Error: keep alive closing, socket.destSock not null but socket not connected');
                }

                socket.destSock = null;
            }

            socket.connected = false;

            printId();

            socket.close();

        }

        setTimeout(function () {checkKeepAlive(socket)}, 3000);
    }
}

function printId() {

    ref = io.clientsWaiting;

    console.log('-------------------------');
    console.log(io.clientsInRooms + ' clients in communication!');
    console.log(ref.length + ' clients waiting!');
    console.log('Printing socket ID of all sockets in the waiting list');

    var i;
    for (i = 0; i < ref.length; i++) {
        if (ref[i] != null)
            console.log(ref[i].id + ' ' + ref[i].connected);
    }

    console.log('-------------------------');

}


