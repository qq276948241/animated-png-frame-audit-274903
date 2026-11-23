var UPNG = require("../UPNG.js");
var B = require("./pngbuilder.js");
var pako = require("pako");
var oracle = require("./oracle.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
	if(cond) { pass++; }
	else { fail++; console.error("FAIL: " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }
function deepEq(a, b, msg) {
	if(a.length !== b.length) { ok(false, msg + " length " + a.length + " vs " + b.length); return; }
	for(var i=0;i<a.length;i++) if(a[i] !== b[i]) { ok(false, msg + " byte " + i + ": " + a[i] + " vs " + b[i]); return; }
	ok(true, msg);
}
function throws(fn, frag, msg) {
	try { fn(); ok(false, msg + " (did not throw)"); }
	catch(e) { ok(String(e).indexOf(frag) >= 0, msg + " (threw: " + e + ")"); }
}

// RGBA8 frame helpers ---------------------------------------------------------
function rgbaFrame(w, h, fn) {
	var u = new Uint8Array(w*h*4);
	for(var y=0;y<h;y++) for(var x=0;x<w;x++) {
		var i=(y*w+x)*4, c = fn(x,y);
		u[i]=c[0]; u[i+1]=c[1]; u[i+2]=c[2]; u[i+3]=c[3];
	}
	return u;
}
function tile(rgba, w, r) {
	var out = new Uint8Array(r.width*r.height*4);
	for(var y=0;y<r.height;y++) for(var x=0;x<r.width;x++) {
		var si=((r.y+y)*w+r.x+x)*4, di=(y*r.width+x)*4;
		out[di]=rgba[si]; out[di+1]=rgba[si+1]; out[di+2]=rgba[si+2]; out[di+3]=rgba[si+3];
	}
	return out;
}
function zNone(tileU8, bpl, h) { return Array.prototype.slice.call(pako.deflate(B.prepFilterNone(tileU8, bpl, h))); }
function zInter(tileU8, fw, fh, cbpp) { return Array.prototype.slice.call(pako.deflate(B.prepInterlaceNone(tileU8, fw, fh, cbpp))); }

// ============================================================================
// 1. Static PNG decoding across every color type / depth
// ============================================================================
(function staticColorTypes() {
	var w=3,h=2;

	// ctype 6 depth 8 RGBA
	var rgba = rgbaFrame(w,h,function(x,y){return [10+x*7,20+y*11,30,40+x*30+y*40];});
	var img = UPNG.decode(B.staticPNG(w,h,6,8,rgba));
	eq(img.ctype,6,"static rgba ctype"); eq(img.depth,8,"static rgba depth");
	eq(img.frames.length,0,"static png has no frames");
	deepEq(new Uint8Array(UPNG.toRGBA8(img)[0]), rgba, "static rgba pixels");

	// ctype 6 depth 16 (big-endian samples must survive untouched in img.data)
	var r16 = new Uint8Array(w*h*8);
	for(var i=0;i<w*h;i++) { r16[i*8]=i*16; r16[i*8+1]=200; r16[i*8+2]=1; r16[i*8+3]=2; r16[i*8+4]=3; r16[i*8+5]=4; r16[i*8+6]=0; r16[i*8+7]=i; }
	var img16 = UPNG.decode(B.staticPNG(w,h,6,16,r16));
	eq(img16.depth,16,"16bit depth retained"); eq(img16.ctype,6,"16bit ctype retained");
	deepEq(new Uint8Array(img16.data), r16, "16bit raw samples not quantized");
	var rgba16 = new Uint8Array(UPNG.toRGBA8(img16)[0]);
	eq(rgba16[0], r16[0], "16bit->8 takes high byte of R");
	eq(rgba16[7], r16[6], "16bit->8 takes high byte of A (0 when value lives in low byte)");

	// ctype 2 RGB depth 8 and 16, with tRNS transparency (16-bit big-endian sample values)
	var rgb8 = new Uint8Array([10,20,30, 40,50,60, 70,80,90, 100,110,120, 10,20,30, 1,2,3]);
	var img2 = UPNG.decode(B.staticPNG(w,h,2,8,rgb8,{trns:[0,10,0,20,0,30]}));
	var out2 = new Uint8Array(UPNG.toRGBA8(img2)[0]);
	eq(out2[3],0,"rgb tRNS makes matching pixel transparent");
	eq(out2[7],255,"rgb tRNS leaves other pixels opaque");
	eq(out2[16+3],0,"rgb tRNS matches repeated pixel");

	var rgb16 = new Uint8Array(w*h*6);
	for(var k=0;k<w*h;k++){ rgb16[k*6]=0; rgb16[k*6+1]=10; rgb16[k*6+2]=0; rgb16[k*6+3]=20; rgb16[k*6+4]=0; rgb16[k*6+5]=30; }
	rgb16[6]=0; rgb16[7]=11; // second pixel R=11, not transparent
	var img2b = UPNG.decode(B.staticPNG(w,h,2,16,rgb16,{trns:[0,10,0,20,0,30]}));
	var out2b = new Uint8Array(UPNG.toRGBA8(img2b)[0]);
	eq(out2b[3],0,"rgb16 tRNS transparent match");
	eq(out2b[7],255,"rgb16 tRNS non-match opaque");
	deepEq(new Uint8Array(img2b.data), rgb16, "rgb16 raw preserved");

	// ctype 4 gray+alpha depth 8 and 16
	var ga8 = new Uint8Array(w*h*2);
	for(var k2=0;k2<w*h;k2++){ ga8[k2*2]=50+k2*20; ga8[k2*2+1]=128; }
	var img4 = UPNG.decode(B.staticPNG(w,h,4,8,ga8));
	var out4 = new Uint8Array(UPNG.toRGBA8(img4)[0]);
	eq(out4[0],50,"gray+alpha R=gray"); eq(out4[1],50,"gray+alpha G=gray"); eq(out4[3],128,"gray+alpha alpha");

	var ga16 = new Uint8Array(w*h*4);
	for(var k3=0;k3<w*h;k3++){ ga16[k3*4]=2; ga16[k3*4+1]=100; ga16[k3*4+2]=0; ga16[k3*4+3]=255; }
	var img4b = UPNG.decode(B.staticPNG(w,h,4,16,ga16));
	deepEq(new Uint8Array(img4b.data), ga16, "gray+alpha 16 raw preserved");
	var out4b = new Uint8Array(UPNG.toRGBA8(img4b)[0]);
	eq(out4b[0],2,"gray16 high byte"); eq(out4b[3],0,"alpha16 high byte 0");

	// ctype 0 gray, all depths, with tRNS
	[1,2,4,8].forEach(function(depth) {
		var vals=[0,1,0,1,1,0]; // for depth 1
		var bpl = Math.ceil(w*depth/8);
		var packed = new Uint8Array(bpl*h);
		for(var p=0;p<w*h;p++) {
			var byte = p*depth>>3, shift = 8 - depth - (p*depth % 8);
			packed[byte] |= (vals[p] % (1<<depth)) << shift;
		}
		var im = UPNG.decode(B.staticPNG(w,h,0,depth,packed,{trns:[0,0]})); // tRNS gray 0
		var om = new Uint8Array(UPNG.toRGBA8(im)[0]);
		eq(om[3],0,"gray depth "+depth+" tRNS transparent");
		eq(om[7],255,"gray depth "+depth+" opaque sample");
	});
	var g16 = new Uint8Array(w*h*2);
	for(var k4=0;k4<w*h;k4++){ g16[k4*2]=k4%2; g16[k4*2+1]=0; }
	var img0b = UPNG.decode(B.staticPNG(w,h,0,16,g16,{trns:[0,0]}));
	var out0b = new Uint8Array(UPNG.toRGBA8(img0b)[0]);
	eq(out0b[3],0,"gray16 tRNS match"); eq(out0b[7],255,"gray16 non-match");

	// ctype 3 palette, all depths, tRNS alpha; indices stay within each depth's range
	var plte = [255,0,0, 0,255,0, 0,0,255, 255,255,0], trns=[0,128,255];
	[1,2,4,8].forEach(function(depth) {
		var maxIdx = (1<<depth)-1, idx=[0,1,maxIdx,0, 1,maxIdx], bpl3 = Math.ceil(w*depth/8), pk = new Uint8Array(bpl3*h);
		for(var p2=0;p2<idx.length;p2++){var byte2=p2*depth>>3,sh2=8-depth-(p2*depth%8);pk[byte2]|=idx[p2]<<sh2;}
		var im3 = UPNG.decode(B.staticPNG(w,h,3,depth,pk,{plte:plte,trns:trns}));
		var o3 = new Uint8Array(UPNG.toRGBA8(im3)[0]);
		eq(o3[0],255,"palette d"+depth+" R"); eq(o3[3],0,"palette d"+depth+" tRNS alpha 0");
		eq(o3[7],128,"palette d"+depth+" tRNS alpha 128");
		var wantA = maxIdx < trns.length ? trns[maxIdx] : 255;
		eq(o3[11],wantA,"palette d"+depth+" alpha of max index ("+maxIdx+")");
	});
	console.log("section 1 done");
})();

// ============================================================================
// 2. Interlaced static PNG equals non-interlaced pixels
// ============================================================================
(function interlacedStatic() {
	var w=9,h=7;
	var rgba = rgbaFrame(w,h,function(x,y){return [(x*23)&255,(y*41)&255,((x+y)*17)&255,255];});
	var flat = B.staticPNG(w,h,6,8,rgba);
	var inter = B.staticPNG(w,h,6,8,rgba,{interlace:true});
	var a = new Uint8Array(UPNG.toRGBA8(UPNG.decode(flat))[0]);
	var b2 = new Uint8Array(UPNG.toRGBA8(UPNG.decode(inter))[0]);
	deepEq(b2, a, "Adam7 static RGBA matches progressive-less");

	// 16-bit interlaced gray+alpha
	var ga = new Uint8Array(w*h*4);
	for(var i=0;i<w*h;i++){ ga[i*4]=1; ga[i*4+1]=i&255; ga[i*4+2]=0; ga[i*4+3]=200; }
	var gFlat = B.staticPNG(w,h,4,16,ga);
	var gInt  = B.staticPNG(w,h,4,16,ga,{interlace:true});
	var c1 = new Uint8Array(UPNG.toRGBA8(UPNG.decode(gFlat))[0]);
	var c2 = new Uint8Array(UPNG.toRGBA8(UPNG.decode(gInt))[0]);
	deepEq(c2, c1, "Adam7 16bit gray+alpha matches");
	console.log("section 2 done");
})();

// ============================================================================
// 3. APNG: frame order, metadata, all disposal/blend combos vs spec oracle
// ============================================================================
(function apngComposition() {
	var W=5,H=5;
	function px(x,y){ return [(x*37+11)&255,(y*53+7)&255,((x*y)*13+3)&255, ((x+y)%3===0?0:(x*40+y*20+30)&255)]; }
	var f0 = rgbaFrame(W,H,px);
	var r1={x:1,y:1,width:3,height:3}, t1raw = tile(f0,W,r1);
	// make frame 1 differ, including partial-alpha and fully-transparent samples
	var t1 = new Uint8Array(t1raw);
	for(var i=0;i<t1.length;i+=4){ t1[i]=(t1[i]+90)&255; t1[i+3]=(i%12===0)?0:(60+(i%190)); }
	var r2={x:2,y:0,width:2,height:4}, t2 = tile(f0,W,r2);
	for(var i2=0;i2<t2.length;i2+=4){ t2[i2+1]=(t2[i2+1]+70)&255; t2[i2+3]=255; }
	var f3 = rgbaFrame(W,H,function(x,y){return [12,34,56, (x===0&&y===0?0:200)];});

	var specFrames = [
		{rect:{x:0,y:0,width:W,height:H}, rgba:f0, blend:0, dispose:0},
		{rect:r1, rgba:t1, blend:1, dispose:1},
		{rect:r2, rgba:t2, blend:0, dispose:2},
		{rect:{x:0,y:0,width:W,height:H}, rgba:f3, blend:1, dispose:0}
	];
	var built = specFrames.map(function(f,idx){
		var bpl=4*f.rect.width;
		return {rect:f.rect, z:zNone(f.rgba,bpl,f.rect.height), delay:[idx+1,10],
			dispose:f.dispose, blend:f.blend, useIDAT: idx===0};
	});
	var buf = B.apng(W,H,6,8,built,{numPlays:0});
	var img = UPNG.decode(buf);

	eq(img.tabs.acTL.num_frames,4,"acTL num_frames");
	eq(img.tabs.acTL.num_plays,0,"num_plays zero means infinite");
	eq(img.frames.length,4,"decoded frame count");
	eq(img.frames[0].usesDefaultIDAT,true,"first frame occupies default IDAT");
	eq(img.frames[0].delay,100,"frame 0 delay 1/10 s = 100ms");
	eq(img.frames[1].delay,200,"frame 1 delay 200ms");
	eq(img.frames[3].delay,400,"frame 3 delay 400ms");
	for(var o=0;o<4;o++) {
		eq(img.frames[o].rect.x,specFrames[o].rect.x,"frame "+o+" rect x");
		eq(img.frames[o].blend,specFrames[o].blend,"frame "+o+" blend kept");
		eq(img.frames[o].dispose,specFrames[o].dispose,"frame "+o+" dispose kept");
		// frame 0's fcTL is seq 0 (its data is in IDAT); later fcTL/fdAT pairs consume two numbers
		eq(img.frames[o].seq, o===0 ? 0 : 2*o-1, "frame "+o+" sequence number");
	}

	var expected = oracle.render(W,H,specFrames);
	var got = UPNG.toRGBA8(img);
	eq(got.length,4,"toRGBA8 returns 4 composited frames");
	for(var f2=0; f2<4; f2++) deepEq(new Uint8Array(got[f2]), expected[f2], "composited frame "+f2+" matches oracle");

	// repeatability: decode once, composite twice -> identical; buffers independent
	var got2 = UPNG.toRGBA8(img);
	for(var f4=0;f4<4;f4++) deepEq(new Uint8Array(got2[f4]), new Uint8Array(got[f4]), "repeated playback frame "+f4);
	var probe = new Uint8Array(got[0]); probe[0] ^= 255;
	ok(new Uint8Array(got2[0])[0] !== probe[0], "returned frame buffers are independent copies");

	// transparent samples in an OVER tile must not touch the backdrop
	var W2=4,H2=4, base=rgbaFrame(W2,H2,function(){return [9,9,9,255];});
	var rT={x:1,y:1,width:2,height:2};
	var tileO = rgbaFrame(2,2,function(x,y){
		if(x===0&&y===0) return [0,0,0,0];          // fully transparent at canvas (1,1)
		if(x===1&&y===1) return [200,100,50,255];   // opaque at canvas (2,2)
		return [200,100,50,128];                    // partial alpha elsewhere
	});
	var frA = [
		{rect:{x:0,y:0,width:W2,height:H2},rgba:base,blend:0,dispose:0},
		{rect:rT,rgba:tileO,blend:1,dispose:0}
	];
	var bA = B.apng(W2,H2,6,8,frA.map(function(f,i){
		return {rect:f.rect,z:zNone(f.rgba,4*f.rect.width,f.rect.height),delay:[1,10],dispose:f.dispose,blend:f.blend,useIDAT:i===0};
	}));
	var gA8 = new Uint8Array(UPNG.toRGBA8(UPNG.decode(bA))[1]);
	var idxClear = ((rT.y+0)*W2 + (rT.x+0))*4; // canvas (1,1): transparent source
	eq(gA8[idxClear],9,"fully transparent OVER sample leaves backdrop R untouched");
	eq(gA8[idxClear+3],255,"fully transparent OVER sample leaves backdrop alpha untouched");
	var idxOpaque = ((rT.y+1)*W2 + (rT.x+1))*4; // canvas (2,2): opaque source replaces
	eq(gA8[idxOpaque],200,"opaque OVER sample replaces backdrop R");
	eq(gA8[idxOpaque+3],255,"opaque OVER sample replaces backdrop alpha");
	var expA = oracle.render(W2,H2,frA)[1];
	deepEq(gA8, expA, "partial-alpha OVER matches oracle math");
	console.log("section 3 done");
})();

// ============================================================================
// 4. Disposal semantics are rectangle-confined (the old whole-canvas bug)
// ============================================================================
(function disposalRect() {
	var W=6,H=6;
	var base = rgbaFrame(W,H,function(x,y){return [x*5,y*5,17,255];});
	var patch = rgbaFrame(2,2,function(){return [255,255,255,255];});
	function build(dispose) {
		// frame 3 only touches a different tile, so frame 2's disposal result stays visible
		return B.apng(W,H,6,8,[
			{rect:{x:0,y:0,width:W,height:H},z:zNone(base,4*W,H),delay:[1,10],dispose:0,blend:0,useIDAT:true},
			{rect:{x:3,y:3,width:2,height:2},z:zNone(patch,8,2),delay:[1,10],dispose:dispose,blend:0},
			{rect:{x:0,y:0,width:1,height:1},z:zNone(new Uint8Array([1,2,3,255]),4,1),delay:[1,10],dispose:0,blend:0}
		]);
	}
	[1,2].forEach(function(dispose) {
		var frames = UPNG.toRGBA8(UPNG.decode(build(dispose)));
		eq(frames.length,3,"dispose "+dispose+" build has 3 frames");
		var f2 = new Uint8Array(frames[2]); // state after frame 2 was disposed and frame 3 rendered
		// pixels outside the (3,3,2,2) rectangle must equal the base frame
		for(var y=0;y<H;y++) for(var x=0;x<W;x++) {
			if(x>=3&&x<5&&y>=3&&y<5) continue;
			if(x===0&&y===0) continue; // frame 3's own tile
			var i=(y*W+x)*4;
			eq(f2[i],base[i],"dispose "+dispose+" keeps outside pixel ("+x+","+y+")");
		}
		// inside the rectangle: dispose 1 -> transparent black; dispose 2 -> base content
		var inside = (4*W+4)*4;
		if(dispose===1) { eq(f2[inside],0,"dispose 1 clears R"); eq(f2[inside+3],0,"dispose 1 clears A"); }
		else { eq(f2[inside],base[inside],"dispose 2 restores prior R"); eq(f2[inside+3],base[inside+3],"dispose 2 restores prior A"); }
	});
	console.log("section 4 done");
})();

// ============================================================================
// 5. Interlaced APNG sub-frames (the old canvas-sized Adam7 bug)
// ============================================================================
(function interlacedAPNG() {
	var W=8,H=8;
	var r={x:2,y:3,width:5,height:4};
	var base = rgbaFrame(W,H,function(x,y){return [x*3,y*3,x+y,255];});
	var sub = rgbaFrame(r.width,r.height,function(x,y){return [(x*50)&255,(y*70)&255,90, (x%2?255:80)];});
	var buf = B.apng(W,H,6,8,[
		{rect:{x:0,y:0,width:W,height:H}, z:zInter(base,W,H,4), delay:[1,10], dispose:0, blend:0, useIDAT:true},
		{rect:r, z:zInter(sub,r.width,r.height,4), delay:[1,10], dispose:0, blend:1}
	],{interlace:true});
	var img = UPNG.decode(buf);
	var got = new Uint8Array(UPNG.toRGBA8(img)[1]);
	var exp = oracle.render(W,H,[
		{rect:{x:0,y:0,width:W,height:H},rgba:base,blend:0,dispose:0},
		{rect:r,rgba:sub,blend:1,dispose:0}
	])[1];
	deepEq(got, exp, "interlaced APNG tile composites exactly like the oracle");
	console.log("section 5 done");
})();

// ============================================================================
// 6. APNG high-bit-depth + palette-tRNS raw frame preservation
// ============================================================================
(function apngRawFormats() {
	var W=4,H=3;
	// 16-bit RGBA APNG, second frame is a sub-rectangle
	var f0 = new Uint8Array(W*H*8);
	for(var i=0;i<W*H;i++){ f0[i*8]=2; f0[i*8+1]=i&255; f0[i*8+2]=0; f0[i*8+3]=10; f0[i*8+4]=0; f0[i*8+5]=20; f0[i*8+6]=1; f0[i*8+7]=254; }
	var r={x:1,y:1,width:2,height:2}, t = new Uint8Array(r.width*r.height*8);
	for(var i2=0;i2<r.width*r.height;i2++){ t[i2*8]=9; t[i2*8+1]=1; t[i2*8+2]=8; t[i2*8+3]=7; t[i2*8+4]=6; t[i2*8+5]=5; t[i2*8+6]=4; t[i2*8+7]=3; }
	var buf16 = B.apng(W,H,6,16,[
		{rect:{x:0,y:0,width:W,height:H},z:zNone(f0,8*W,H),delay:[1,10],dispose:0,blend:0,useIDAT:true},
		{rect:r,z:zNone(t,8*r.width,r.height),delay:[1,10],dispose:0,blend:0}
	]);
	var img16 = UPNG.decode(buf16);
	deepEq(new Uint8Array(img16.data), f0, "16bit APNG default image raw preserved");
	deepEq(new Uint8Array(img16.frames[1].data), t, "16bit APNG sub-frame raw preserved (big-endian)");
	eq(img16.frames[1].data.length, r.width*r.height*8, "16bit sub-frame not truncated");
	var rgba8 = new Uint8Array(UPNG.toRGBA8(img16)[1]);
	eq(rgba8[((1*W+1)*4)+0], 9, "16bit frame compositing reads high byte");

	// palette APNG with tRNS
	var plte=[10,20,30, 40,50,60, 70,80,90], trns=[0,255,128];
	var idx0 = new Uint8Array([0,1,2,0, 1,2,0,1, 2,0,1,2]);
	var idxt = new Uint8Array([2,0, 1,2]);
	var rp={x:1,y:1,width:2,height:2};
	var bufP = B.apng(W,H,3,8,[
		{rect:{x:0,y:0,width:W,height:H},z:zNone(idx0,W,H),delay:[1,10],dispose:0,blend:0,useIDAT:true},
		{rect:rp,z:zNone(idxt,2,2),delay:[1,10],dispose:0,blend:0}
	],{plte:plte,trns:trns});
	var imgP = UPNG.decode(bufP);
	var op = new Uint8Array(UPNG.toRGBA8(imgP)[0]);
	eq(op[3],0,"palette APNG tRNS alpha 0");
	eq(op[7],255,"palette APNG tRNS alpha 255");
	eq(op[11],128,"palette APNG tRNS alpha 128");
	var op1 = new Uint8Array(UPNG.toRGBA8(imgP)[1]);
	eq(op1[((1*W+1)*4)+3],128,"palette APNG frame 1 tRNS applied");

	// gray+alpha 16 APNG
	var ga = new Uint8Array(W*H*4);
	for(var i3=0;i3<W*H;i3++){ ga[i3*4]=0; ga[i3*4+1]=100+i3; ga[i3*4+2]=1; ga[i3*4+3]=60; }
	var bufGA = B.apng(W,H,4,16,[
		{rect:{x:0,y:0,width:W,height:H},z:zNone(ga,4*W,H),delay:[1,10],dispose:0,blend:0,useIDAT:true}
	]);
	var imgGA = UPNG.decode(bufGA);
	deepEq(new Uint8Array(imgGA.frames[0].data), ga, "gray+alpha 16 APNG raw preserved");

	// legal APNG with no IDAT: the first frame itself is carried by fdAT
	(function() {
		var nW=4,nH=4;
		var base0 = rgbaFrame(nW,nH,function(){return [100,110,120,255];});
		var sub0  = rgbaFrame(2,2,function(){return [1,2,3,255];});
		var noIdat = B.apng(nW,nH,6,8,[
			{rect:{x:0,y:0,width:nW,height:nH},z:zNone(base0,4*nW,nH),delay:[1,10],dispose:0,blend:0,useIDAT:false},
			{rect:{x:0,y:0,width:2,height:2},z:zNone(sub0,8,2),delay:[2,10],dispose:0,blend:0}
		],{numPlays:5});
		ok(B.findChunks(noIdat).some(function(c){return c.type==="fdAT";}),"no-IDAT file uses fdAT");
		ok(!B.findChunks(noIdat).some(function(c){return c.type==="IDAT";}),"no-IDAT file has no IDAT");
		var im = UPNG.decode(noIdat);
		eq(im.frames[0].usesDefaultIDAT,false,"first frame flagged as not using default IDAT");
		eq(im.tabs.acTL.num_plays,5,"finite num_plays 5 stored");
		var gg = UPNG.toRGBA8(im);
		eq(gg.length,2,"no-IDAT animation yields 2 frames");
		eq(new Uint8Array(gg[0])[0],100,"no-IDAT first frame pixels correct");
	})();

	// loop count zero (infinite) and a finite number are distinct metadata
	(function() {
		var nW=2,nH=2, u0=rgbaFrame(nW,nH,function(){return [5,5,5,255];});
		var inf = B.apng(nW,nH,6,8,[
			{rect:{x:0,y:0,width:nW,height:nH},z:zNone(u0,8,nH),delay:[1,10],dispose:0,blend:0,useIDAT:true}
		],{numPlays:0});
		eq(UPNG.decode(inf).tabs.acTL.num_plays,0,"num_plays 0 means infinite and is preserved as 0");
	})();
	console.log("section 6 done");
})();

// ============================================================================
// 7. Error handling: malformed streams must throw stable errors, no partial state
// ============================================================================
(function errorHandling() {
	var W=4,H=4;
	var rgba = rgbaFrame(W,H,function(x,y){return [x,y,x+y,255];});
	var good = B.staticPNG(W,H,6,8,rgba);
	function copy() { return good.slice(0); } // independent ArrayBuffer copy

	throws(function(){ UPNG.decode(new Uint8Array(7).buffer); }, "not a PNG", "truncated signature");
	throws(function(){ var b=new Uint8Array(copy()); b[0]=0; UPNG.decode(b.buffer); }, "not a PNG", "bad magic");

	// truncation inside the last chunk (the 8-byte signature stays intact)
	throws(function(){ UPNG.decode(copy().slice(0, good.byteLength-20)); }, "past end of file", "cut tail");

	// CRC corruption (damage IHDR body but leave its CRC stale)
	(function(){
		var b = new Uint8Array(copy());
		var ih = B.findChunk(b.buffer,"IHDR");
		b[ih.body+2] ^= 0xff;
		throws(function(){ UPNG.decode(b.buffer); }, "CRC", "IHDR CRC mismatch detected");
	})();

	// corrupted deflate stream with a recomputed, valid CRC -> inflate error, not garbage
	(function(){
		var b = new Uint8Array(copy());
		var id = B.findChunk(b.buffer,"IDAT");
		b[id.body+2] ^= 0xaa;
		B.overwrite(b.buffer, id.end, B.u32(B.CRC(b, id.off+4, id.len+4)));
		throws(function(){ UPNG.decode(b.buffer); }, "compressed data", "broken zlib rejected");
	})();

	// deflate stream whose CRC is stale is rejected before inflate is even attempted
	(function(){
		var b2 = new Uint8Array(copy());
		var id2 = B.findChunk(b2.buffer,"IDAT");
		b2[id2.body+2] ^= 0xaa; // damage body without recomputing CRC
		throws(function(){ UPNG.decode(b2.buffer); }, "CRC mismatch", "stale CRC rejected first");
	})();

	// inflate length mismatch (declared shorter than the bitmap needs)
	(function(){
		var shortZ = Array.prototype.slice.call(pako.deflate(new Uint8Array(10)));
		var ihdr = B.u32(W).concat(B.u32(H),[8,6,0,0,0]);
		var chs=[B.chunk("IHDR",ihdr), B.chunk("IDAT",shortZ), B.chunk("IEND",[])];
		throws(function(){ UPNG.decode(B.chunksToBuffer(chs)); }, "inflate length", "short inflate rejected");
	})();

	// invalid filter byte is rejected during decode (filters are applied eagerly)
	(function(){
		var filtered = B.prepFilterNone(rgba, 4*W, H);
		filtered[0] = 9;
		var z = Array.prototype.slice.call(pako.deflate(filtered));
		var chs2=[B.chunk("IHDR",B.u32(W).concat(B.u32(H),[8,6,0,0,0])), B.chunk("IDAT",z), B.chunk("IEND",[])];
		throws(function(){ UPNG.decode(B.chunksToBuffer(chs2)); }, "filter", "invalid row filter rejected");
	})();

	// oversized IHDR rejected before allocation
	(function(){
		var chs3=[B.chunk("IHDR",B.u32(100000).concat(B.u32(100000),[8,6,0,0,0])), B.chunk("IEND",[])];
		throws(function(){ UPNG.decode(B.chunksToBuffer(chs3)); }, "too large", "pixel budget enforced");
	})();

	// unknown critical chunk refused (uppercase first byte marks a critical type)
	(function(){
		var raw = B.chunk("zzZZ",[1,2,3,4]);
		raw[4]=65; raw[5]=66; raw[6]=67; raw[7]=68; // rename to "ABCD"
		var crc = B.CRC(new Uint8Array(raw), 4, 8);
		raw[raw.length-4]=(crc>>>24)&255; raw[raw.length-3]=(crc>>>16)&255;
		raw[raw.length-2]=(crc>>>8)&255; raw[raw.length-1]=crc&255;
		var b5 = B.splice(copy(), good.byteLength-12, raw);
		throws(function(){ UPNG.decode(b5); }, "critical", "unknown critical chunk rejected");
	})();

	// APNG-specific structural errors
	var fr = function(seqMap, extra) {
		var opts = {numPlays:1}; if(seqMap) opts.seqMap = seqMap;
		if(extra) for(var k in extra) opts[k]=extra[k];
		return B.apng(W,H,6,8,[
			{rect:{x:0,y:0,width:W,height:H},z:zNone(rgba,4*W,H),delay:[1,10],dispose:0,blend:0,useIDAT:true},
			{rect:{x:0,y:0,width:2,height:2},z:zNone(rgbaFrame(2,2,function(){return [1,2,3,4];}),8,2),delay:[1,10],dispose:0,blend:0}
		],opts);
	};
	throws(function(){ UPNG.decode(fr({1:0})); }, "sequence number", "duplicate sequence number rejected");
	throws(function(){ UPNG.decode(fr(null,{numFramesOverride:3})); }, "frame count mismatch", "acTL frame mismatch rejected");
	throws(function(){ UPNG.decode(fr(null,{numFramesOverride:0})); }, "zero frames", "zero acTL frames rejected");
	throws(function(){
		// first frame blend 1 is illegal
		var b6 = B.apng(W,H,6,8,[
			{rect:{x:0,y:0,width:W,height:H},z:zNone(rgba,4*W,H),delay:[1,10],dispose:0,blend:1,useIDAT:true}
		]);
		UPNG.decode(b6);
	}, "first frame", "first-frame blend SOURCE enforced");
	throws(function(){
		var b7 = B.apng(W,H,6,8,[
			{rect:{x:0,y:0,width:W,height:H},z:zNone(rgba,4*W,H),delay:[1,10],dispose:0,blend:0,useIDAT:true},
			{rect:{x:3,y:3,width:4,height:4},z:zNone(new Uint8Array(4*4*4),16,4),delay:[1,10],dispose:0,blend:0}
		]);
		UPNG.decode(b7);
	}, "outside the", "fcTL outside canvas rejected");

	// missing frame data: remove the last fdAT chunk
	(function(){
		var b8 = fr();
		var all = B.findChunks(b8), last = all.filter(function(c){return c.type==="fdAT";}).pop();
		var cutBuf = B.cut(b8, last.off, last.end-last.off);
		// removal either leaves a dangling length ("past end of file") or a frame with no bytes
		throws(function(){ UPNG.decode(cutBuf); }, "past end of file", "frame without fdAT rejected");
	})();

	// failures must not leave a partially usable result: the same buffer never returns an image
	var badCount=0;
	try { UPNG.decode(fr({1:0})); } catch(e) { badCount++; }
	try { UPNG.decode(fr({1:0})); } catch(e) { badCount++; }
	eq(badCount,2,"corrupted stream fails deterministically");
	console.log("section 7 done");
})();

// ============================================================================
// 8. Encoder: legal APNG, pixel-exact round-trip, metadata and loop counts
// ============================================================================
(function encoderRoundtrip() {
	var W=6,H=5;
	var frames = [
		rgbaFrame(W,H,function(x,y){return [x*9,y*13,(x*y*7)&255,255];}),
		rgbaFrame(W,H,function(x,y){return [ (x>1&&y>1&&x<5&&y<4)?200:x*9, (y*13+5)&255, 90, (x===2&&y===2?0:255)];}),
		rgbaFrame(W,H,function(x,y){return [1,2,3, (x+y)%2?255:64];})
	];
	var dels = [100, 250, 70000];
	var buf = UPNG.encode(frames.map(function(f){return f.buffer;}), W, H, 0, dels);
	var img = UPNG.decode(buf);
	eq(img.tabs.acTL.num_frames,3,"encoded acTL frame count");
	eq(img.tabs.acTL.num_plays,0,"default loop is infinite (0)");
	var got = UPNG.toRGBA8(img);
	eq(got.length,3,"round-trip frame count");
	for(var i=0;i<3;i++) deepEq(new Uint8Array(got[i]), frames[i], "encode/decode frame "+i+" pixel-exact");
	eq(img.frames[0].delay,100,"delay 100ms round-trip");
	eq(img.frames[1].delay,250,"delay 250ms round-trip");
	eq(img.frames[2].delay,70000,"delay 70000ms survives u16 fraction encoding");

	// loop counts: 0 (infinite) vs finite are distinct and preserved
	var bufLoop3 = UPNG.encode([frames[0].buffer,frames[1].buffer],W,H,0,[50,50]);
	eq(UPNG.decode(bufLoop3).tabs.acTL.num_plays,0,"no loop option -> 0");
	var bufFinite = (function(){
		var b = new Uint8Array(UPNG.encode([frames[0].buffer,frames[1].buffer],W,H,0,[50,50]));
		var ac = B.findChunk(b.buffer,"acTL");
		B.overwrite(b.buffer, ac.body+4, B.u32(3));
		// CRC over type+body; pass the Uint8Array view so offsets share one baseline
		B.overwrite(b.buffer, ac.end, B.u32(B.CRC(b, ac.off+4, ac.len+4)));
		return b.buffer;
	})();
	eq(UPNG.decode(bufFinite).tabs.acTL.num_plays,3,"finite loop count 3 preserved and distinct from 0");

	// static single-frame encode keeps the old entry behavior: no animation chunks
	var one = UPNG.encode([frames[0].buffer],W,H,0);
	var types = B.findChunks(one).map(function(c){return c.type;});
	ok(types.indexOf("acTL")===-1,"single-frame PNG contains no acTL");
	ok(types.indexOf("fcTL")===-1,"single-frame PNG contains no fcTL");
	ok(types.indexOf("fdAT")===-1,"single-frame PNG uses IDAT only");
	var oneImg = UPNG.decode(one);
	eq(oneImg.frames.length,0,"single frame decodes as static");
	deepEq(new Uint8Array(UPNG.toRGBA8(oneImg)[0]), frames[0], "static encode pixel-exact");

	// every encoded APNG is independently re-decodable (repeated playback)
	var again = UPNG.toRGBA8(UPNG.decode(buf));
	for(var i2=0;i2<3;i2++) deepEq(new Uint8Array(again[i2]), frames[i2], "second decode pass identical "+i2);
	console.log("section 8 done");
})();

// ============================================================================
// 9. encodeLL preserves native bit depth / color type
// ============================================================================
(function encodeLLRoundtrip() {
	var W=3,H=2;
	var ga16 = new Uint8Array(W*H*4);
	for(var i=0;i<W*H;i++){ ga16[i*4]=1; ga16[i*4+1]=i*40+10; ga16[i*4+2]=0; ga16[i*4+3]=255; }
	var buf = UPNG.encodeLL([ga16.buffer],W,H,1,1,16);
	var img = UPNG.decode(buf);
	eq(img.ctype,4,"encodeLL gray+alpha ctype");
	eq(img.depth,16,"encodeLL depth 16 retained");
	deepEq(new Uint8Array(img.data), ga16, "encodeLL 16bit samples round-trip raw");

	// multi-frame 16-bit RGBA APNG via encodeLL (cc=3,ac=1 -> ctype 6, 8 bytes/pixel)
	var f0=new Uint8Array(W*H*8), f1=new Uint8Array(W*H*8);
	for(var k=0;k<W*H;k++){
		// high byte of R lives at k*8+0; alpha high byte at k*8+6
		f0[k*8+0]=20; f0[k*8+6]=255;
		f1[k*8+0]=90; f1[k*8+6]=255;
	}
	var buf2 = UPNG.encodeLL([f0.buffer,f1.buffer],W,H,3,1,16,[33,44]);
	var img2 = UPNG.decode(buf2);
	eq(img2.ctype,6,"encodeLL RGBA ctype 6");
	eq(img2.tabs.acTL.num_frames,2,"encodeLL APNG frame count");
	eq(img2.frames[0].delay,33,"encodeLL delay 33ms");
	eq(img2.frames[1].delay,44,"encodeLL delay 44ms");
	deepEq(new Uint8Array(img2.frames[0].data), f0, "encodeLL APNG frame0 raw 16bit");
	deepEq(new Uint8Array(img2.frames[1].data), f1, "encodeLL APNG frame1 raw 16bit");
	var g = UPNG.toRGBA8(img2);
	eq(new Uint8Array(g[1])[0],90,"encodeLL 16bit playback quantizes high byte of R");
	console.log("section 9 done");
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
