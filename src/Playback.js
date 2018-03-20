import Sound from "./Sound";
import EventDispatcher from "@createjs/core/src/events/EventDispatcher";
import Declicker from "./utils/Declicker"

class Playback extends EventDispatcher {

	get elapsed() {
		let ctx = Sound.context;
		return ctx.currentTime - this._startTime + this._elapsedOffset
	}

	get duration() {
		return this.buffer.duration;
	}

	get playing() {
		return Boolean(this._sourceNode) && !this.paused && !this._stopping;
	}

	get paused() {
		return this._pausing || this._paused;
	}

	constructor(audioBuffer, options = {}) {
		super();

		let ctx = Sound.context;

		this.fademaskDuration = 0.02;
		this.fademaskCallback = null;

		// Audio tree setup
		this.declicker = new Declicker(this.fademaskerNode);
		this.declicker.on("fadeOutComplete", this.handleFadeMaskComplete, this);
		// Currently no need to listen to the fade-in complete.
		this.outputNode = this.faderNode = ctx.createGain();

		this.volumeNode = ctx.createGain();
		this.volumeNode.connect(this.outputNode);

		this.fademaskerNode = ctx.createGain();
		this.fademaskerNode.connect(this.volumeNode);

		this.fxBus = ctx.createGain();
		this.fxBus.connect(this.fademaskerNode);

		// Data tracking
		this.buffer = audioBuffer;
		this._startTime = null;
		this._elapsedOffset = 0; // The amount of time elapsed, including pauses.
		this._paused = false;

		this.remainingLoops = options.loops ? Math.max(options.loops | 0, -1) : 0;

		this._play(); // TODO: 10ms fade in to prevent clicks
	}

	_play(delay = 0, offset = 0) {
		let ctx = Sound.context;

		if (this._sourceNode) {
			return; // Do nothing - sound is already playing. Playing multiple sounds should be done by playing the sample again.
		}

		this.fademaskerNode.gain.value = 0;
		this._sourceNode || this._createSourceNode();
		this._sourceNode.start(ctx.currentTime + delay, offset, duration);
		this.declicker.fadeIn();

		this._startTime = ctx.currentTime;
		this._elapsedOffset = offset;
		this._paused = false;
	}

	_createSourceNode() {
		let ctx = Sound.context;

		this._sourceNode = ctx.createBufferSource();
		this._sourceNode.buffer = this.buffer;
		this._sourceNode.connect(this.fxBus);

		this._sourceNode.onended = this.handleEnded.bind(this);
	}

	pause() {
		if (!this.playing) { // This checks for paused, pausing, stopping and stopped.
			return;
		}

		this.dispatchEvent("paused");
		this._pausing = true;
		this.declicker.fadeOut();
	}

	resume() {

		if(this._stopping){
			// Do nothing - interrupting a stop is not allowed.
		}else if(this._paused){
			this._play(0, this._elapsedOffset);
			this._paused = false;
		}else if(this._pausing){
			this.declicker.cancelFade();
			this._pausing = false;
		}

		// Implicitly does nothing if the sound is neither paused nor pausing.
	}

	_pauseCore() {
		this._elapsedOffset = this.elapsed;

		this._sourceNode.stop();
		this._sourceNode = null;
		this._pausing = false;
		this._paused = true;
	}

	stop() {
		if (this._stopping) { // Already stopping - don't need to stop again.
			return;
		}

		if(this._paused){
			this._stopCore(); // Not playing currently - can stop immediately.
		}

		this.dispatchEvent("stopped");
		this._stopping = true;
		this.declicker.fadeOut();
	}

	_stopCore() {
		// after the crossfade, do the actual stopping part.
		this.destroy(); // An "end" event will be dispatched in response to the _sourceNode being told to stop in the destroy function, so is not needed here.
	}

	destroy() {
		if (this._sourceNode) {
			this._sourceNode.onended = null; // Stop listening before stopping the node, since the listener does things we don't want for a destroyed sound
			this._sourceNode && this._sourceNode.stop();
		}
		this.dispatchEvent("end"); // Manually dispatch the end event since the listener has been removed
		this._sourceNode = null;
		this._paused = false;
		this.dispatchEvent("destroyed");
		// TODO: review approach for preventing future plays.
		this._play = () => {
			throw new Error("Cannot play Playback after it has been destroyed.")
		};
		this.removeAllEventListeners();
		this.fademaskerNode.removeAllEventListeners();
	}

	handleEnded() {
		if (this.paused) {
			// Do nothing - the buffer just sent an ended event, but this is because the Playback was just paused,
			// and the pause function already dispatched an event.
		} else {
			// Reached end of playback. Loop if we have remaining loops - destroy otherwise.

			if (this.remainingLoops !== 0) {
				this.dispatchEvent("end");
				this.loop();
			} else {
				// No event here - the destroy function dispatches an end event.
				this.destroy();
			}
		}
	}

	handleFadeMaskComplete(){
		if(this._stopping){
			this._stopCore();
		}else if(this._pausing) {
			this._pauseCore();
		}
	}

}

export default Playback;
