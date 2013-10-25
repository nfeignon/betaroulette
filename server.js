

var express = require('express');
var app = express();
var ws = require('websocket.io');
var uuid = require('node-uuid');

app.use(express["static"]('./public'));

app.get('/', function(req, res) {
    res.sendfile(__dirname + '/index.html/');
});

var server = app.listen(3002);
var io = ws.attach(server);


io.clientsWaiting || (io.clientsWaiting = []);
io.clientsInRooms || (io.clientsInRooms = 0);


function isPeerAvailable(sock) {
    if (io.clientsWaiting.length > 1) {
        sock.send(JSON.stringify({
            type: 'peer_available'
        }));
    }
}

function sendNbOfClients(sock, nb) {
    sock.send(JSON.stringify({
        type: 'nb_clients',
        data: nb
    }));
}


io.on('connection', function(socket) {
    console.log('------------------------------------------------');
    console.log('Client connected from ' + socket.req.connection.remoteAddress);
    console.log('User Agent: ' + socket.req.headers['user-agent'] + '\n');

    var base;

    socket.id = uuid.v1();
    console.log('attributed id = ' + socket.id);
    
    io.clientsWaiting.push(socket);

    socket.send(JSON.stringify({
        type: 'assigned_id',
        id: socket.id
    }));

    sendNbOfClients(socket, io.clientsInRooms);

    isPeerAvailable(socket);              // send msg of type 'peer_available' if someone is available to chat

    console.log('new client connected :  clientsWaiting size = ' + io.clientsWaiting.length);

    var destSock;

    return socket.on('message', function(data) {
        var msg, sock, i, ref;
        msg = JSON.parse(data);

        console.log('recu un message de type ' + msg.type);

        ref = io.clientsWaiting;

        switch (msg.type) {
            case 'received_offer':
            case 'received_candidate':
            case 'received_answer':

                var messageSent = false;

                if (ref.length > 1) {

                    // if we don't have a destination socket
                    if (destSock == null) {
                        for (i = 0; i < ref.length; i++) {
                            if (ref[i].id !== socket.id) {
                                destSock = ref[i];
                                break;
                            }
                        }
                        if (destSock == null)           // if we didn't found a partner to chat with, it should not happen
                            console.log('partner not found, error !!!');
                    }
                } else {
                    if (destSock == null)
                        console.log('No one to chat with !');
                }

                if (destSock != null) {
                    //console.log('Me, ' + socket.id + ' am sending a msg ' + msg.type + ' to ' + destSock.id);
                    destSock.send(JSON.stringify(msg));
                }

                break;
            
            case 'connection_ok':

                if (destSock == null) {
                    console.log('ERROR: remote socket doesn\'t exist!');
                    return;
                }

                destSock.send(JSON.stringify({
                    'type': msg.type
                }));

                var toDelete = [];
                for (i = 0; i < ref.length ; i++)
                    if (ref[i].id === socket.id || ref[i].id === destSock.id)
                        toDelete.push(ref[i]);

                for (i = 0; i < toDelete.length; i++)
                    ref.splice(ref.indexOf(toDelete[i]), 1);

                io.clientsInRooms += 2;

                console.log('CONNECTION OK, now ' + ref.length + ' clients waiting, ' + io.clientsInRooms + ' clients in communication.');
                printId(ref);
                break;

            case 'next':
                var pos = ref.indexOf(socket);
                if (pos >= 0) {
                    console.log('ERROR: client\'s socket should not be in the waiting list');             // sanity check
                    return;
                }

                if (destSock != null) {
                    var pos = ref.indexOf(destSock);
                    if (pos >= 0) {
                        console.log('ERROR: remote socket should not be in the waiting list');
                        return;
                    }
                } else {
                    console.log('ERROR: remote socket doesn\'t exist!');
                    return;
                }

                destSock.send(JSON.stringify({        // tell peer that he has been nexted
                    type: 'nexted' 
                }));

                io.clientsInRooms -= 2;

                ref.push(socket);

                destSock = null;
                isPeerAvailable(socket);

                printId(ref);

                break;

            case 'next_ack':

                ref.push(socket);           // FIXME TODO FIXME   le next_ack a fait foirer les next, et tout le reste, à vooooooir

                destSock = null;

                break;

            case 'remote_connection_closed':
                destSock = null;
                isPeerAvailable(socket);

                destSock = null;


                break;

            case 'close':

                console.log('Client deconnecté ! id: ' + socket.id);

                var pos = ref.indexOf(socket);
                if (pos >= 0)
                    ref.splice(pos, 1);     // remove socket of disconnected client, if it exists


                if (destSock != null) {
                    io.clientsInRooms -= 2;
                    ref.push(destSock);                     // add socket of his partner to the waiting list
                    destSock.send(JSON.stringify({        // tell that peer is disconnected
                        type: 'connection_closed' 
                    }));
                }

                printId(ref);

                socket.close();

                break;
        }
    });
});

function printId(ref) {
    console.log('-------------------------');
    console.log(io.clientsInRooms + ' clients in communication!');
    console.log(io.clientsWaiting.length + ' clients waiting!');
    console.log('Printing socket ID of all sockets in the waiting list');

    var i;
    for (i = 0; i < ref.length; i++) {
        if (ref[i] != null)
            console.log(ref[i].id);
    }

    console.log('-------------------------');

}

