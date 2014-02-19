

// This is all in adapter.js
// the norm is not yet fully normalized, this is temporary, TODO update
//var RTCPeerConnection = window.PeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection; 
//navigator.getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia || navigator.webkitGetUserMedia;
//var RTCIceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate;
//var RTCSessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription;


// the socket handles sending messages between peer connections while they are in the
// process of connecting
var socket = new WebSocket('ws://' + window.location.host + window.location.pathname);
console.log('socket param: ' + 'ws://' + window.location.host + window.location.pathname);

var mediaConstraints = {
    'mandatory': {
        'OfferToReceiveAudio':true,
        'OfferToReceiveVideo':true
    }
};

var pc;
var pc_config = webrtcDetectedBrowser === 'firefox' ?
  {'iceServers':[{'url':'stun:23.21.150.121'}]} :
  {'iceServers': [{'url': 'stun:stun.l.google.com:19302'}]};
var pc_constraints = {
  'optional': [
    {'DtlsSrtpKeyAgreement': true}                   // this is needed for chrome / firefox interoperability
  ]};

var localStream;
var remoteStream;
var connected = false;
var sessionReady = false;
var webcamAvailable = false;
var nextButton;


socket.onopen = function() {
    sessionReady = true;
};

socket.onclose = function() {
    console.log('ERROR: connection error');
    alert('ERROR: disconnected from server');
}

socket.onmessage = function(message) {
    var msg = JSON.parse(message.data);

    switch(msg.type) {
        case 'assigned_id':
            socket.id = msg.id;
            console.log('socket id attributed = ' + socket.id);
            break;

        case 'peer_available':
            console.log('Peer is available, now trying to connect to him with RTCPeerConnection');
            doCall();
            break;

        case 'received_offer': 
            console.log('received offer', msg.data);
            pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            pc.createAnswer(function(description) {
                console.log('sending answer');
                pc.setLocalDescription(description); 
                socket.send(JSON.stringify({
                    type: 'received_answer', 
                    data: description
                }));
            },
            function (err) {
                console.error(err);
            },
            mediaConstraints);
            break;

        case 'received_answer':
            console.log('received answer');
            if (!connected) {
                pc.setRemoteDescription(new RTCSessionDescription(msg.data));
                connected = true;
                nextButton.hidden = false;
                socket.send(JSON.stringify({
                    type: 'connection_ok'
                }));
            }
            break;

        case 'received_candidate':
            console.log('received candidate');
            var candidate = new RTCIceCandidate({
                sdpMLineIndex: msg.label,
                candidate: msg.candidate
            });
            pc.addIceCandidate(candidate);
            break;

        case 'connection_ok':
            connected = true;
            nextButton.hidden = false;
            break;

        case 'partner_location':
            addMessageToChat('Partner',  'is from ' + msg.data);
            break;

        case 'nexted':
            console.log('You\'ve been nexted!');
            connected = false;
            nextButton.hidden = true;
            remoteVideo.style.visibility = 'hidden';
            $('#msg').val('').focus();
            $('#chat_area').empty();

            restartPc();

            socket.send(JSON.stringify({
                type: 'next_ack'
            }));

            break;

        case 'chat_msg':
            addMessageToChat('Partner: ', msg.data);
            break;

        case 'connection_closed':
            console.log('connection closed by peer');
            remoteVideo.style.visibility = 'hidden';
            connected = false;
            nextButton.hidden = true;
            $('#msg').val('').focus();
            $('#chat_area').empty();

            restartPc();

            socket.send(JSON.stringify({
                type: 'remote_connection_closed'
            }));

            break;
    }
};


//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////


function createNewPeerConnection() {
    try {
        pc = new RTCPeerConnection(pc_config, pc_constraints);
        pc.onicecandidate = handleIceCandidate;
        pc.onaddstream = handleRemoteStreamAdded;
    } catch (e) {
        console.log('Failed to create PeerConnection, exception: ' + e.message);
        return;
    }
}

function handleIceCandidate(event) {
    if (event.candidate) {
        socket.send(JSON.stringify({
            type: 'received_candidate',
            label: event.candidate.sdpMLineIndex,
            id: event.candidate.sdpMid,
            candidate: event.candidate.candidate
        }));
    } else {
        console.log('End of candidates.');
    }
}

function handleRemoteStreamAdded(event) {
    console.log('Remote stream added');
    remoteStream = event.stream;
    remoteVideo.src = window.URL.createObjectURL(event.stream);
    remoteVideo.style.visibility = 'visible';
    remoteVideo.play();
}

function restartPc() {                          // FIXME
    pc.close();
    createNewPeerConnection();
    pc.addStream(localStream);
}

createNewPeerConnection();

//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////

function sendReadyMsg() {
    if (isReady()) {
        console.log('Sent session ready');
        socket.send(JSON.stringify({
            type: 'client_ready'
        }));

        setTimeout('sendKeepAlive()', 4000);            // we can start to send keep alive packets
    }
    else
        if (webcamAvailable)
            setTimeout('sendReadyMsg()', 1000);
        else
            alert('Webcam not available');
}

function isReady() {
    return localStream && sessionReady && socket.id && webcamAvailable;
}

function sendKeepAlive() {
    socket.send(JSON.stringify({
        type: 'keep_alive'
    }));

    // console.log('Sending keep-alive packet...');

    setTimeout('sendKeepAlive()', 4000);
}

function doCall() {
    // this initializes the peer connection
    console.log('Creating offer for peer');
    pc.createOffer(function(description) {
        pc.setLocalDescription(description);
        socket.send(JSON.stringify({
            type: 'received_offer',
            data: description
        }));
    }, 
    function(err) {
        console.error(err);
    },
    mediaConstraints);
}

function next() {
    if (!connected) {
        console.log('Error: you can\'t next someone if you\'re not connected!');            // sanity check
        return;
    }

    console.log('Nexting this peer');
    connected = false;
    nextButton.hidden = true;
    remoteVideo.style.visibility = 'hidden';
    $('#msg').val('').focus();
    $('#chat_area').empty();

    socket.send(JSON.stringify({
        type: 'next'
    }));

    restartPc();
}

function addMessageToChat(name, msg) {
    // the message should be already escaped by the server
    msg = linkify(msg);
    $('#chat_text').append('<p><strong>' + name + '</strong> ' + msg + '</p>');
}

window.onload = function() {

    $('#chat_form').submit(function () {            // FIXME it looks ugly 
        var message = $('#msg').val();

        socket.send(JSON.stringify({
            type: 'chat_msg',
            data: message
        }));

        addMessageToChat('You: ', message);
        $('#msg').val('').focus();

        return false;                               // so that we don't reload the page
    });

    nextButton = document.getElementById("nextButton");
    nextButton.hidden = true;

    if (nextButton.addEventListener) {
        nextButton.addEventListener("click", function() { next();});
    } else {
        nextButton.attachEvent("click", function() { next();});
    };


    // gets local video stream and renders to localVideo
    getUserMedia({audio: true, video: true}, function(s) {    // we continue on this function when the user has accepted the webcam
        localStream = s;
        pc.addStream(s);
        localVideo.src = window.URL.createObjectURL(s);
        localVideo.play();

        setTimeout(function() {
            webcamAvailable = localVideo.videoWidth != 0;           // wait until we can now if a webcam is available
            sendReadyMsg();
        }, 1000);

    }, function(e) {
        console.log('getUserMedia error: ' + e.name);
        alert('Error: ' + e.name);
        socket.send(JSON.stringify({
            type: 'close'
        }));
    });
};

window.onbeforeunload = function() {
    socket.send(JSON.stringify({
        type: 'close'
    }));
    pc.close();
    pc = null;
};


//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////

function linkify(inputText) {
    var replacedText, replacePattern1, replacePattern2, replacePattern3;

    //Fix . and @, needed because of the escaping on the server's side
    replacedText = inputText.replace('&commat;', '@');
    replacedText = replacedText.replace('&period;', '.');

    //URLs starting with http://, https://, or ftp://
    replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    replacedText = replacedText.replace(replacePattern1, '<a href="$1" target="_blank">$1</a>');

    //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
    replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
    replacedText = replacedText.replace(replacePattern2, '$1<a href="http://$2" target="_blank">$2</a>');

    //Change email addresses to mailto:: links.
    replacePattern3 = /(([a-zA-Z0-9\-\_\.])+@[a-zA-Z\_]+?(\.[a-zA-Z]{2,6})+)/gim;
    replacedText = replacedText.replace(replacePattern3, '<a href="mailto:$1">$1</a>');

    return replacedText;
}

