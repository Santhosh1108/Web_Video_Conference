// Create Agora client
var client = AgoraRTC.createClient({mode: "rtc", codec: "vp8"});

// RTM Global Vars
var isLoggedIn = false;

var localTracks = {
    videoTrack: null,
    audioTrack: null
};
var remoteUsers = {};
// Agora client options
var options = {
    appid: null,
    channel: null,
    uid: null,
    token: null,
    accountName: null
};

$("#join-form").submit(async function (e) {
    e.preventDefault();
    $("#join").attr("disabled", true);
    try {
        options.appid = $("#appid").val();
        // FIXED: the form has no #token input, so this always read as
        // undefined. Removed the dead reference. For an App-Certificate-
        // enabled Agora project, a real token would need to come from a
        // token server, not a client-side field anyway.
        options.channel = $("#channel").val();
        options.accountName = $('#accountName').val();
        await join();
        // FIXED: leave button should only enable after a *successful* join,
        // not unconditionally in `finally` (which ran even on failure).
        $("#leave").attr("disabled", false);
    } catch (error) {
        console.error(error);
        // FIXED: previously if join() threw, the Join button stayed
        // disabled forever with no way to retry except refreshing the page.
        $("#join").attr("disabled", false);
        alert("Failed to join the room. Check your AppID/Channel and try again.");
    }
})

$("#leave").click(function (e) {
    leave();
})

async function join() {
    $("#mic-btn").prop("disabled", false);
    $("#video-btn").prop("disabled", false);
    RTMJoin();
    // add event listener to play remote tracks when remote user publishs.
    client.on("user-published", handleUserPublished);
    client.on("user-left", handleUserLeft);
    // join a channel and create local tracks, we can use Promise.all to run them concurrently
    [options.uid, localTracks.audioTrack, localTracks.videoTrack] = await Promise.all([
        // join the channel
        client.join(options.appid, options.channel, options.token || null),
        // create local tracks, using microphone and camera
        AgoraRTC.createMicrophoneAudioTrack(
            {AEC: true, ANS: true}
        ),
        AgoraRTC.createCameraVideoTrack()
    ]);
    // play local video track
    localTracks.videoTrack.play("local-player");
    $("#local-player-name").text(`localVideo(${
        options.uid
    })`);
    // publish local tracks to channel
    await client.publish(Object.values(localTracks));
    console.log("publish success");
}
async function leave() {
    for (trackName in localTracks) {
        var track = localTracks[trackName];
        if (track) {
            track.stop();
            track.close();
            $('#mic-btn').prop('disabled', true);
            $('#video-btn').prop('disabled', true);
            localTracks[trackName] = undefined;
        }
    }
    // remove remote users and player views
    remoteUsers = {};
    $("#remote-playerlist").html("");
    // leave the channel
    await client.leave();
    $("#local-player-name").text("");
    $("#join").attr("disabled", false);
    $("#leave").attr("disabled", true);
    console.log("client leaves channel success");
}

// SECURITY FIX: `singleMember` is a display name typed by another user
// (accountName) and was being inserted directly into innerHTML via string
// concatenation in THREE places (initial load, MemberJoined, MemberLeft) —
// e.g. a name like <img src=x onerror=alert(document.cookie)> would
// execute in every other participant's browser (stored XSS). It was also
// used unescaped inside an `id="remoteAudio-${singleMember}"` attribute,
// so a name containing a quote character would break the markup outright.
// Centralizing rendering into one escaped helper fixes both issues and
// removes the triplicated code.
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
}

function renderMemberList(memberNames, accountName) {
    var rows = memberNames
        .filter(function (singleMember) { return singleMember != accountName; })
        .map(function (singleMember) {
            var safeName = escapeHtml(singleMember);
            return `<li class="mt-2">
                  <div class="row">
                      <p>${safeName}</p>
                   </div>
                   <div class="mb-4">
                     <button class="text-white btn btn-control mx-3 remoteMicrophone micOn" data-peer-id="${safeName}">Toggle Mic</button>
                     <button class="text-white btn btn-control remoteCamera camOn" data-peer-id="${safeName}">Toggle Video</button>
                    </div>
                 </li>`;
        });
    $("#insert-all-users").html(rows.join(""));
}

async function RTMJoin() { // Create Agora RTM client
    const clientRTM = AgoraRTM.createInstance($("#appid").val(), {enableLogUpload: false});
    var accountName = $('#accountName').val();
    // Login
    clientRTM.login({uid: accountName}).then(() => {
        console.log('AgoraRTM client login success. Username: ' + accountName);
        isLoggedIn = true;
        // RTM Channel Join
        var channelName = $('#channel').val();
        channel = clientRTM.createChannel(channelName);
        channel.join().then(() => {
            console.log('AgoraRTM client channel join success.');
            // Get all members in RTM Channel
            channel.getMembers().then((memberNames) => {
                console.log("------------------------------");
                console.log("All members in the channel are as follows: ");
                console.log(memberNames);
                renderMemberList(memberNames, accountName);
            });
            // Send peer-to-peer message for audio muting and unmuting
            $(document).on('click', '.remoteMicrophone', function () {
                // FIXED: previously parsed the peer id out of the element's
                // `id` attribute (which held the raw, unescaped member
                // name). Now reads it from a data attribute set from the
                // already-escaped name, and declares the variable properly
                // instead of leaking it onto the global scope.
                let peerId = $(this).data('peer-id');
                console.log("Remote microphone button pressed.");
                let peerMessage = "audio";
                clientRTM.sendMessageToPeer({
                    text: peerMessage
                }, peerId,).then(sendResult => {
                    if (sendResult.hasPeerReceived) {
                        console.log("Message has been received by: " + peerId + " Message: " + peerMessage);
                    } else {
                        console.log("Message sent to: " + peerId + " Message: " + peerMessage);
                    }
                })
            });
            // Send peer-to-peer message for video muting and unmuting
            $(document).on('click', '.remoteCamera', function () {
                let peerId = $(this).data('peer-id');
                console.log("Remote video button pressed.");
                let peerMessage = "video";
                clientRTM.sendMessageToPeer({
                    text: peerMessage
                }, peerId,).then(sendResult => {
                    if (sendResult.hasPeerReceived) {
                        console.log("Message has been received by: " + peerId + " Message: " + peerMessage);
                    } else {
                        console.log("Message sent to: " + peerId + " Message: " + peerMessage);
                    }
                })
            });
            // Display messages from peer
            clientRTM.on('MessageFromPeer', function ({
                text
            }, peerId) {
                console.log(peerId + " muted/unmuted your " + text);
                // FIXED: selectors updated to match the new
                // data-peer-id="..." attribute (see renderMemberList) now
                // that the raw member name is no longer used inside an id.
                if (text == "audio") {
                    console.log("Remote video toggle reached with " + peerId);
                    let micBtn = $(`.remoteMicrophone[data-peer-id="${peerId}"]`);
                    if (micBtn.hasClass('micOn')) {
                        localTracks.audioTrack.setEnabled(false);
                        console.log("Remote Audio Muted for: " + peerId);
                        micBtn.removeClass('micOn');
                    } else {
                        localTracks.audioTrack.setEnabled(true);
                        console.log("Remote Audio Unmuted for: " + peerId);
                        micBtn.addClass('micOn');
                    }
                } else if (text == "video") {
                    console.log("Remote video toggle reached with " + peerId);
                    let camBtn = $(`.remoteCamera[data-peer-id="${peerId}"]`);
                    if (camBtn.hasClass('camOn')) {
                        localTracks.videoTrack.setEnabled(false);
                        console.log("Remote Video Muted for: " + peerId);
                        camBtn.removeClass('camOn');
                    } else {
                        localTracks.videoTrack.setEnabled(true);
                        console.log("Remote Video Unmuted for: " + peerId);
                        camBtn.addClass('camOn');
                    }
                }
            })
            // Display channel member joined updated users
            channel.on('MemberJoined', function () { // Get all members in RTM Channel
                channel.getMembers().then((memberNames) => {
                    console.log("New member joined so updated list is: ");
                    console.log(memberNames);
                    renderMemberList(memberNames, accountName);
                });
            })
            // Display channel member left updated users
            channel.on('MemberLeft', function () { // Get all members in RTM Channel
                channel.getMembers().then((memberNames) => {
                    console.log("A member left so updated list is: ");
                    console.log(memberNames);
                    renderMemberList(memberNames, accountName);
                });
            });
        }).catch(error => {
            // Handles failures to join the RTM *channel* (login already succeeded).
            console.log('AgoraRTM client channel join failed: ', error);
            alert("Joined RTM, but failed to join the channel. Please try again.");
        });
        // FIXED: this .catch() used to be chained after channel.join()'s
        // .catch(), which meant it could only ever fire if the *channel
        // join* error handler itself threw — it never actually caught a
        // failed clientRTM.login(). A login failure was an unhandled
        // promise rejection with zero user feedback. Attached directly to
        // the login() promise now.
    }).catch(err => {
        console.log('AgoraRTM client login failure: ', err);
        alert("Failed to log in to chat/presence service. Please try again.");
    });
    // Logout
    document.getElementById("leave").onclick = async function () {
        console.log("Client logged out of RTM.");
        await clientRTM.logout();
    }
}

async function subscribe(user, mediaType) {
    const uid = user.uid;
    // subscribe to a remote user
    await client.subscribe(user, mediaType);
    console.log("subscribe success");
    if (mediaType === 'video') {
        const player = $(`
      <div id="player-wrapper-${uid}">
        <p class="player-name">remoteUser(${uid})</p>
        <div id="player-${uid}" class="player"></div>
      </div>
    `);
        $("#remote-playerlist").append(player);
        user.videoTrack.play(`player-${uid}`);
    }
    if (mediaType === 'audio') {
        user.audioTrack.play();
    }
}

// Handle user publish
function handleUserPublished(user, mediaType) {
    const id = user.uid;
    remoteUsers[id] = user;
    subscribe(user, mediaType);
}

// Handle user left
function handleUserLeft(user) {
    const id = user.uid;
    delete remoteUsers[id];
    $(`#player-wrapper-${id}`).remove();
}

// Initialise UI controls
enableUiControls();

// Action buttons
function enableUiControls() {
    $("#mic-btn").click(function () {
        toggleMic();
    });
    $("#video-btn").click(function () {
        toggleVideo();
    });
}

// Toggle Mic
function toggleMic() {
    if ($("#mic-icon").hasClass('fa-microphone')) {
        localTracks.audioTrack.setEnabled(false);
        console.log("Audio Muted.");
    } else {
        localTracks.audioTrack.setEnabled(true);
        console.log("Audio Unmuted.");
    }
    $("#mic-icon").toggleClass('fa-microphone').toggleClass('fa-microphone-slash');
}

// Toggle Video
function toggleVideo() {
    if ($("#video-icon").hasClass('fa-video')) {
        localTracks.videoTrack.setEnabled(false);
        console.log("Video Muted.");
    } else {
        localTracks.videoTrack.setEnabled(true);
        console.log("Video Unmuted.");
    }
    $("#video-icon").toggleClass('fa-video').toggleClass('fa-video-slash');
}
