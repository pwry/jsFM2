class Overseer {
    constructor (nes) {
        // -- OVERSEER STATE SETUP --
        this.animation = null;
        this.rom = null;
        this.fm2 = null;

        // -- NES SETUP --
        // em-fceux needs to be initialized from an event handler, so we have to pass it in later.
        this.bitmask = 0;

        this.BUTTONS = {
            'A':      0
        ,   'B':      1
        ,   'SELECT': 2
        ,   'START':  3
        ,   'UP':     4
        ,   'DOWN':   5
        ,   'LEFT':   6
        ,   'RIGHT':  7
        }

        // Positive values: render n frames per tick.
        // Negative values: render -1/n frames per tick.
        // n=2: 200%, n=-2: 50%.
        // -1 and 0 don't make sense as values, so speedUp() and speedDown() skip them.
        this.resetSpeed();

        function isROMData(str) { return str.slice(0, 4) === 'rom=' }
        function isFM2Data(str) { return str.slice(0, 4) === 'fm2=' }
        function handleHash(str) {
            const a = str.split('&')[0];
            const b = str.split('&')[1];
            var rom, fm2; 

            if (isROMData(a)) { rom = a.slice(4); } else if (isFM2Data(a)) { fm2 = a.slice(4); }
            if (isROMData(b)) { rom = b.slice(4); } else if (isFM2Data(b)) { fm2 = b.slice(4); }

            return {'rom': rom, 'fm2': fm2}
        }

        // See if we were passed rom and fm2 URLs in the hash
        if (window.location.hash) {
            const {rom, fm2} = handleHash(window.location.hash.slice(1)) // discard initial #

            // TODO: display that stuff is loaded instead of / near the file selector
            if (rom) this.setROMFromURL(rom);
            if (fm2) this.setFM2FromURL(fm2);
        }

        // See if we were passed rom and fm2 base64 data in window.name
        // Note: if something is passed through both methods, window.name takes precedence
        if (window.name) {
            const {rom, fm2} = handleHash(window.name);

            if (rom) {
                const romBStr = atob(rom);
                const romArr = new Uint8Array(romBStr.split('').map(x => x.charCodeAt(0)));
                this.setROM(romArr);
            }
            if (fm2) {
                const fm2BStr = atob(fm2);
                this.setFM2(fm2BStr);
            }
        }
    }

    resetSpeed() {
        this.speed = 1;
        this.speedI = 0;
        this.paused = false;
    }
    isPaused() { return this.paused; }
    togglePause() { this.paused = !this.paused; return this.paused; }

    // button codes are defined in this.BUTTONS
    buttonDown(port, buttonCode) {
        this.bitmask |= (1 << buttonCode);
    }
    buttonUp(port, buttonCode) {
        this.bitmask &= ~(1 << buttonCode);
    }

    speedUp() {
        this.speed++;
        if (this.speed === -1) this.speed = 1;
        this.speedI = 1;
    }
    speedDown() {
        this.speed--;
        if (this.speed === 0) this.speed = -2;
    }

    handleButtons() {
        this.nes.setControllerBits(this.bitmask);
    }

    // -- INPUT HELPERS --
    keyboardDown(evt) {
        const button = this.mapCodes(evt.keyCode);
        if (button !== false) this.buttonDown(1, button)
    }
    keyboardUp(evt) {
        const button = this.mapCodes(evt.keyCode);
        if (button !== false) this.buttonUp(1, button);
    }

    mapCodes(code) {
        const CODES = {
            90: this.BUTTONS.A,      // Z
            88: this.BUTTONS.B,      // X
            32: this.BUTTONS.SELECT, // space
            13: this.BUTTONS.START,  // enter
            38: this.BUTTONS.UP,     // up
            40: this.BUTTONS.DOWN,   // down
            37: this.BUTTONS.LEFT,   // left
            39: this.BUTTONS.RIGHT,  // right
        }
        return CODES.hasOwnProperty(code) ? CODES[code] : false;
    }

    bindKeys() {
        document.addEventListener('keydown', this.keyboardDown.bind(this));
        document.addEventListener('keyup', this.keyboardUp.bind(this)); 
    }
    unbindKeys() {
        document.removeEventListener('keydown', this.keyboardDown.bind(this));
        document.removeEventListener('keyup', this.keyboardUp.bind(this));
    }

    // rom should be a Uint8Array
    // supported file formats: NES, ZIP, NSF
    setROM(rom) {
        this.rom = rom;
    }
    // fm2 should be a binary string
    // (TODO: rewrite fm2 handling so it takes a Uint8Array?)
    setFM2(fm2) {
        this.fm2raw = fm2;
        this.fm2 = new FM2(fm2, this, false); // bool param: debug mode
    }

    setNES(nes) { this.nes = nes; }

    loadROM() {
        this.nes.loadGame(this.rom);
    }

    setROMFromURL(url) {
        const that = this;
        fetch(url).then(response => {
            if (response.ok) {
                response.arrayBuffer().then(buffer => {
                    that.setROM(new Uint8Array(buffer));
                });
            } else {
                throw Error;
            }
        })
    }
    setFM2FromURL(url) {
        const that = this;
        fetch(url).then(response => {
            if (response.ok) {
                response.arrayBuffer().then(buffer => {
                    const fm2u8 = new Uint8Array(buffer);
                    const fm2bs = fm2u8.reduce((acc, i) => acc + String.fromCharCode(i), ''); // uint8array to binary string
                    that.setFM2(fm2bs);
                });
            } else {
                throw Error;
            }
        })
    }

    playROM() {
        this.loadROM();
        if (this.animation) window.cancelAnimationFrame(this.animation);
        this.animation = window.requestAnimationFrame(this.playROMFrame.bind(this));

        this.speedI = 1;

        this.bindKeys();
    }
    playROMFrame() {
        this.animation = window.requestAnimationFrame(this.playROMFrame.bind(this));
        this.handleButtons();
        this.nes.update();
    }

    playFM2() {
        if (this.animation) window.cancelAnimationFrame(this.animation);
        this.unbindKeys();
        this.handledFM2EOF = false;

        // incantations discovered by trial and error
        // have to run update before setPaused, but that messes with state
        this.loadROM();
        this.fm2.reset();
        this.nes.saveState();
        this.nes.update();
        this.nes.setPaused(true);
        this.nes.loadState();

        this.resetSpeed();

        this.animation = window.requestAnimationFrame(this.playFM2Frame.bind(this));
    }
    playFM2Frame() {
        this.animation = window.requestAnimationFrame(this.playFM2Frame.bind(this));
        if (this.paused) return;

        const go = () => { 
            this.fm2.nextFrame(this.nes);
            this.handleButtons();
            this.nes.advanceFrame();
            this.nes.update();
            this.testEOF();
        }
        
        if (this.speed === 1) {
            go();
        } else if (this.speed > 1) {
            for (let i = 0; i < this.speed; i++) {
                go();
            }
        } else if (this.speed < 0) {
            if (this.speedI === -this.speed) {
                go();
                this.speedI = 0;
            }
            this.speedI++;
        }
    }
    testEOF() {
        // off by one
        // if (this.fm2.eof() && !this.handledFM2EOF) {
        //     // ideally we wouldn't go into the document from the overseer
        //     // but w/e this is good enough for now (TODO?)
        //     const pauseButton = document.getElementById('fm2-ui-pause');
        //     pauseButton.innerText = '🔚';
        //     pauseButton.title = 'Paused (movie ended)';
        //     this.paused = true;
        //     this.handledFM2EOF = true;
        // }
    }

    play() {
        // If we just have a ROM, play a ROM.
        // If we have a ROM and an FM2, play the FM2.
        // If we just have an FM2, that's no good.

        if (this.rom && !this.fm2) this.playROM();
        if (this.rom &&  this.fm2) this.playFM2();
        if (!this.rom) throw new Error('No ROM loaded!');
    }
}