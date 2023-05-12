var WebML = function(opts){
    this.opts = opts;
    this.Float16 = opts.Float16;
	this.NoiseFactor = opts.Noise || 0;
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2',{antialias: false, alpha: true, depth: false});
    this.gl.viewport(0,0,65536,65536);
	this.gl.scissor(0,0,65536,65536);
    this.gl.getExtension('EXT_color_buffer_float');
    this.gl.getExtension('EXT_color_buffer_half_float');
    var IB = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, IB);
    this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2,3,2,1]), this.gl.STATIC_DRAW);
    this.vs = this.gl.createShader(this.gl.VERTEX_SHADER);
    this.gl.shaderSource(this.vs,`#version 300 es
    highp vec4 p[4] = vec4[4](vec4(1.0,1.0,0.0,1.0),vec4(-1.0,1.0,0.0,1.0),vec4(1.0,-1.0,0.0,1.0),vec4(-1.0,-1.0,0.0,1.0));
    void main(){
        gl_Position = p[gl_VertexID];
    }
    `);
    this.gl.compileShader(this.vs);
    if (!this.gl.getShaderParameter(this.vs, this.gl.COMPILE_STATUS)){
        console.error(this.gl.getShaderInfoLog(this.vs));
    }
    var self = this;
    if (opts.Float16) {
        self.RGBAF = this.gl.RGBA16F;
        self.RGBF = this.gl.RGB16F;
		self.RGF = this.gl.RG16F;
        self.RF = this.gl.R16F;
        self.FLOAT = this.gl.HALF_FLOAT;
    } else {
        self.RGBAF = this.gl.RGBA32F;
        self.RGBF = this.gl.RGB32F;
		self.RGF = this.gl.RG32F;
        self.RF = this.gl.R32F;
        self.FLOAT = this.gl.FLOAT;
    }
	this.MaxValueSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
	this.Lerp = function(a,b,t) {
		return ((1-t)*a)+(t*b);
	}
    function createProgram(fsScorce) {
        var fs = self.gl.createShader(self.gl.FRAGMENT_SHADER);
		if (self.Float16) {
			fsScorce = fsScorce.replaceAll("highp","mediump");
		}
        self.gl.shaderSource(fs,fsScorce);
        self.gl.compileShader(fs);
        var program = self.gl.createProgram();
        self.gl.attachShader(program, self.vs);
        self.gl.attachShader(program, fs);
        self.gl.linkProgram(program);
        if (!self.gl.getProgramParameter(program, self.gl.LINK_STATUS)) {
            console.error('Could not initialise shaders');
            console.error(self.gl.getShaderInfoLog(fs));
			alert(self.gl.getShaderInfoLog(fs));
        }
        return program;
    }
    this.randn = function() {
        var u = 0, v = 0;
        while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
        while(v === 0) v = Math.random();
        return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    }
    var drawPgrm = createProgram(`#version 300 es
    uniform sampler2D u_image;
	uniform highp float uMult;
    out highp vec4 o_color;
	highp vec3 sigmoid(highp vec3 x) {
		return 1.0/(1.0+exp(-x));
	}
    void main(){
        o_color = vec4(texelFetch(u_image, ivec2(gl_FragCoord.xy-0.5), 0).xyz*uMult,1.0);
		// o_color = vec4(sigmoid(texelFetch(u_image, ivec2(gl_FragCoord.xy-0.5), 0).xyz*uMult),1.0);
    }`);
	var drawPgrmuMult = this.gl.getUniformLocation(drawPgrm,"uMult");
    this.drawTexture = function(tex,res) {
        this.canvas.width = res[0];
        this.canvas.height = res[1];
        this.gl.useProgram(drawPgrm);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);
    }
	this.toHalf = function(fbits) {
		var sign  = (fbits >> 16) & 0x8000;          // sign only
		var val   = ( fbits & 0x7fffffff ) + 0x1000; // rounded value
	
		if( val >= 0x47800000 ) {             // might be or become NaN/Inf
		  if( ( fbits & 0x7fffffff ) >= 0x47800000 ) {
											  // is or must become NaN/Inf
			if( val < 0x7f800000 ) {          // was value but too large
			  return sign | 0x7c00;           // make it +/-Inf
			}
			return sign | 0x7c00 |            // remains +/-Inf or NaN
				( fbits & 0x007fffff ) >> 13; // keep NaN (and Inf) bits
		  }
		  return sign | 0x7bff;               // unrounded not quite Inf
		}
		if( val >= 0x38800000 ) {             // remains normalized value
		  return sign | val - 0x38000000 >> 13; // exp - 127 + 15
		}
		if( val < 0x33000000 )  {             // too small for subnormal
		  return sign;                        // becomes +/-0
		}
		val = ( fbits & 0x7fffffff ) >> 23;
		return sign|((fbits&0x7fffff|0x800000)+( 0x800000>>>val-102)>>126-val);
	};
	this.toFloat = function(h) {
		var s = (h & 0x8000) >> 15;
		var e = (h & 0x7C00) >> 10;
		var f = h & 0x03FF;
		if(e == 0) {
			return (s?-1:1) * 0.00006103515625 * (f/(2**10));
		} else if (e == 0x1F) {
			return f?NaN:((s?-1:1)*Infinity);
		}
		return (s?-1:1) * (2**(e-15)) * (1+(f/Math.pow(2, 10)));
	}
    this.Uint16ArrayToFloat32Array = function(data) {
        var result = new Float32Array(data.length);
        for (var i=0;i<data.length;i++) {
            // var F16 = (data[i]%1024)/512;
            // F16 *= 2**((Math.floor(data[i]/1024)%32)-15);
            // F16 *= (Math.floor(data[i]/32768)==1)?-1:1;
            // result[i] = F16;

			result[i] = self.toFloat(data[i]);
        }
        return result;
    }
    // this.Float32ArrayToUint16Array = function(data) {
    //     var result = new Uint16Array(data.length);
    //     for (var i=0;i<data.length;i++) {
    //         var U16 = 0;
    //         var exp = Math.ceil(Math.max(Math.log2(Math.abs(data[i]))+15,0));
    //         U16 = Math.floor(512*data[i]/(2**(exp-15)));
    //         U16 += exp*1024;
    //         U16 += (data[i]<0)?32768:0;
    //         result[i] = U16;
    //     }
    //     return result;
    // }
	this.Float32ArrayToUint16Array = function(data) {
		if (data.constructor == Float32Array) {
			data = new Int32Array(data.buffer);
		} else {
			data = new Int32Array(new Float32Array(data).buffer);
		}
        var result = new Uint16Array(data.length);
        for (var i=0;i<data.length;i++) {
            // result[i] = ((data[i]&0xc0000000)>>16)|((data[i]&0xf800000)>>14)|((data[i]&0x7fe000)>>16)
			result[i] = self.toHalf(data[i]);
        }
        return result;
    }
    this.textureToArray = function(tex,res) {
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.FrameBuffer);
		this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0, this.gl.TEXTURE_2D, tex, 0);
		var channels = res[1] === 1 ? 1 : 4;
        if (self.Float16) {
            var data = new Uint16Array(res[0]*res[1]*channels);
        } else {
            var data = new Float32Array(res[0]*res[1]*channels);
        }
		if (channels === 4) {
			this.gl.readPixels(0,0,res[0],res[1],this.gl.RGBA,self.FLOAT,data);
		} else {
			this.gl.readPixels(0,0,res[0],res[1],this.gl.RED,self.FLOAT,data);
		}
		if (self.Float16) {
            return self.Uint16ArrayToFloat32Array(data);
        } else {
            return data;
        }
	}
	this.AllValues = [];
    this.Value = function(size,Texture) {
        this.size = size;
        if (Texture) {
			if (Texture.constructor == Float32Array) {
				if (size[2] == 1) {
					this.Texture = self.gl.createTexture();
					self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
					self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_MIN_FILTER, self.gl.NEAREST);
					self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_MAG_FILTER, self.gl.NEAREST);
					self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_WRAP_S, self.gl.CLAMP_TO_EDGE);
					self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_WRAP_T, self.gl.CLAMP_TO_EDGE);
					var loop = this.size[0]*this.size[1];
					var arr = new Float32Array(loop);
					arr.set(Texture.subarray(0,loop),0);
					if (self.Float16) {
						arr = self.Float32ArrayToUint16Array(arr);
					}
					self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.RF, this.size[0], this.size[1], 0, self.gl.RED, self.FLOAT, arr);
				} else {
					this.Texture = self.gl.createTexture();
					self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
					self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_MIN_FILTER, self.gl.NEAREST);
					self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_MAG_FILTER, self.gl.NEAREST);
					self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_WRAP_S, self.gl.CLAMP_TO_EDGE);
					self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_WRAP_T, self.gl.CLAMP_TO_EDGE);
					var loop = this.size[0]*this.size[1];
					var arr = new Float32Array(loop*4);
					var channels = Math.round(Texture.length/loop);
					if (channels == 1) {
						for (var i=0; i<loop; i++) {
							arr.set([Texture[i],Texture[i],Texture[i],Texture[i]],i*4);
						}
					} else {
						for (var i=0; i<loop; i++) {
							arr.set(Texture.subarray(i*channels,(i+1)*channels),i*4);
						}
					}
					if (self.Float16) {
						arr = self.Float32ArrayToUint16Array(arr);
					}
					self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.RGBAF, this.size[0], this.size[1], 0, self.gl.RGBA, self.FLOAT, arr);
				}
			} else {
				this.Texture = Texture;
			}
        } else {
			if (size[2] == 1) {
				this.Texture = self.gl.createTexture();
				self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
				self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_MIN_FILTER, self.gl.NEAREST);
				self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_MAG_FILTER, self.gl.NEAREST);
				self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_WRAP_S, self.gl.CLAMP_TO_EDGE);
				self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_WRAP_T, self.gl.CLAMP_TO_EDGE);
				self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.RF, this.size[0], this.size[1], 0, self.gl.RED, self.FLOAT, null);
			} else {
				this.Texture = self.gl.createTexture();
				self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
				self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_MIN_FILTER, self.gl.NEAREST);
				self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_MAG_FILTER, self.gl.NEAREST);
				self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_WRAP_S, self.gl.CLAMP_TO_EDGE);
				self.gl.texParameteri(self.gl.TEXTURE_2D, self.gl.TEXTURE_WRAP_T, self.gl.CLAMP_TO_EDGE);
				self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.RGBAF, this.size[0], this.size[1], 0, self.gl.RGBA, self.FLOAT, null);
			}
        }
		self.AllValues.push(this);
		this.set = function(data,channels) {
			if (data.constructor == Float32Array) {
				var loop = this.size[0]*this.size[1];
				channels = channels || Math.round(data.length/loop);
				if (channels === 1) {
					var arr = new Float32Array(loop);
					arr.set(data.subarray(0,loop),0);
					self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
					if (self.Float16) {
						arr = self.Float32ArrayToUint16Array(arr);
					}
					self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.RF, this.size[0], this.size[1], 0, self.gl.RED, self.FLOAT, arr);
				} else {
					var arr = new Float32Array(loop*4);
					if (channels == 1) {
						for (var i=0; i<loop; i++) {
							arr.set([data[i],data[i],data[i],data[i]],i*4);
						}
					} else {
						for (var i=0; i<loop; i++) {
							arr.set(data.subarray(i*channels,(i+1)*channels),i*4);
						}
					}
					self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
					if (self.Float16) {
						arr = self.Float32ArrayToUint16Array(arr);
					}
					self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.RGBAF, this.size[0], this.size[1], 0, self.gl.RGBA, self.FLOAT, arr);
				}
			} else if (data.constructor == self.Value) {
				this.setSize(data.size);
				self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
				self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, data.Texture, 0);
				self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
				self.gl.copyTexImage2D(self.gl.TEXTURE_2D,0,self.RGBAF,0,0,this.size[0],this.size[1],0);
			} else if (data.constructor == String) {
				var arr = self.textToFlattenedArray(data);
				var arr2 = new Float32Array(arr.length+self.WordEmbedingDims);
				arr2.set(self.Embeddings[0],0);
				arr2.set(arr,self.WordEmbedingDims);
				this.setSize([self.WordEmbedingDims,Math.floor(arr2.length/self.WordEmbedingDims),1]);
				this.set(arr2,1);
			} else {
				self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
				self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.RGBAF, self.gl.RGBA, self.FLOAT, data);
				// self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.gl.RGBA, self.gl.RGBA, self.gl.UNSIGNED_BYTE, data);
			}
		}
		this.clone = function() {
			var t = new self.Value(this.size);
			t.set(this);
			return t;
		}
        this.toArray = function(channels) {
			channels = channels || this.size[2];
            var data = self.textureToArray(this.Texture,this.size);
            var result = new Float32Array(this.size[0]*this.size[1]*channels);
            var idx = 0;
            for (var i=0; i<data.length; i+=4) {
                for (var j=0; j<channels; j++) {
                    result[idx] = data[i+j];
                    idx++;
                }
            }
            return result;
        }
		this.toArrayRed = function() {
            var data = self.textureToArray(this.Texture,this.size);
            var resultData = new Float32Array(this.size[0]*this.size[1]);
			var result = [];
            var idx = 0;
            for (var i=0; i<data.length; i+=4) {
                resultData[i>>2] = data[i];
            }
			for (var i=0; i<resultData.length; i+=this.size[0]) {
				result.push(resultData.subarray(i,i+this.size[0]));
			}
            return result;
        }
		this.toArrayGreen = function() {
            var data = self.textureToArray(this.Texture,this.size);
            var resultData = new Float32Array(this.size[0]*this.size[1]);
			var result = [];
            var idx = 0;
            for (var i=1; i<data.length; i+=4) {
                resultData[i>>2] = data[i];
            }
			for (var i=0; i<resultData.length; i+=this.size[0]) {
				result.push(resultData.subarray(i,i+this.size[0]));
			}
            return result;
        }
		this.toArrayBlue = function() {
            var data = self.textureToArray(this.Texture,this.size);
            var resultData = new Float32Array(this.size[0]*this.size[1]);
			var result = [];
            var idx = 0;
            for (var i=2; i<data.length; i+=4) {
                resultData[i>>2] = data[i];
            }
			for (var i=0; i<resultData.length; i+=this.size[0]) {
				result.push(resultData.subarray(i,i+this.size[0]));
			}
            return result;
        }
		this.toArrayAlpha = function() {
            var data = self.textureToArray(this.Texture,this.size);
            var resultData = new Float32Array(this.size[0]*this.size[1]);
			var result = [];
            var idx = 0;
            for (var i=3; i<data.length; i+=4) {
                resultData[i>>2] = data[i];
            }
			for (var i=0; i<resultData.length; i+=this.size[0]) {
				result.push(resultData.subarray(i,i+this.size[0]));
			}
            return result;
        }
		this.display = function(mult) {
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, null);
			self.gl.useProgram(drawPgrm);
			self.gl.uniform1f(drawPgrmuMult,mult || 1);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
			self.canvas.width = this.size[0];
			self.canvas.height = this.size[1];
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
		}
        this.setSize = function(size) {
            if (this.size[0] !== size[0] || this.size[1] !== size[1]) {
                this.size = size;
                self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
                self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.RGBAF, this.size[0], this.size[1], 0, self.gl.RGBA, self.FLOAT, null);
            }
        }
		this.clear = function() {
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Texture);
			self.gl.texImage2D(self.gl.TEXTURE_2D, 0, self.RGBAF, this.size[0], this.size[1], 0, self.gl.RGBA, self.FLOAT, null);
		}
        this.delete = function() {
			var idx = self.AllValues.indexOf(this);
			if (idx !== -1) {
				self.AllValues.splice(idx,1);
			}
            self.gl.deleteTexture(this.Texture);
            delete this;
        }
    }
	this.GetGPUMemoryUsage = function() {
		var result = 0;
		for (var i=0; i<self.AllValues.length; i++) {
			if (!self.AllValues[i]) {
				self.AllValues.splice(i,1);
				i--;
			} else {
				if (self.AllValues[i].size[2] === 1) {
					result += self.AllValues[i].size[0]*self.AllValues[i].size[1];
				} else {
					result += self.AllValues[i].size[0]*self.AllValues[i].size[1]*4;
				}
			}
		}
		if (self.Float16) {
			result *= 2;
		} else {
			result *= 4;
		}
		return {bytes:result,kilobytes:result*0.0009765625,megabytes:result*0.00000095367431640625,gigabytes:result*0.000000000931322574615478515625};
	}
	this.State = function(inArr) {
		var arr = [];
		for (var i=0; i<inArr.length; i++) {
			if (inArr[i] instanceof self.Value) {
				arr.push(inArr[i]);
			} else if (inArr[i] instanceof self.State) {
				arr.push(inArr[i].Values);
			}
		}
		this.Values = arr.flat();
		this.clone = function() {
			var s = [];
			for (var i=0; i<this.Values.length; i++) {
				s.push(this.Values[i].clone());
			}
			return new self.State(s);
		}
		this.set = function(s) {
			var loop = Math.min(this.Values.length,s.Values.length)
			for (var i=0; i<loop; i++) {
				this.Values[i].set(s.Values[i]);
			}
		}
	}
	this.Parameters = function(arr,layer) {
		this.Values = arr;
		this.Layer = layer;
		//if (layer) {
		//	this.ParameterCount = layer.ParameterCount || 0;
		//} else {
			this.ParameterCount = 0;
			for (var i=0; i<this.Values.length; i++) {
				if (this.Values[i] instanceof self.Value) {
					this.ParameterCount += this.Values[i].size[0]*this.Values[i].size[1]*(this.Values[i].size[2] || 1);
				} else if (this.Values[i] instanceof self.Parameters) {
					this.ParameterCount += this.Values[i].ParameterCount;
				}
			}
		//}
		this.clone = function() {
			var s = [];
			for (var i=0; i<this.Values.length; i++) {
				s.push(this.Values[i].clone());
			}
			return new self.State(s);
		}
		this.toArray = function() {
			var s = [];
			var len = 0;
			for (var i=0; i<this.Values.length; i++) {
				s.push(this.Values[i].toArray());
				len += s[i].length;
			}
			var result = new Float32Array(len);
			var idx = 0;
			for (var i=0; i<s.length; i++) {
				result.set(s[i],idx);
				idx += s[i].length;
			}
			return result;
			//if (this.Layer) {
			//	return result.slice(0,this.Layer.ParameterCount);
			//} else {
			//	return result;
			//}
		}
		this.set = function(val) {
			var s = [];
			var idx = 0;
			for (var i=0; i<this.Values.length; i++) {
				if (this.Values[i] instanceof self.Value) {
					this.Values[i].set(val.subarray(idx,idx+(this.Values[i].size[0]*this.Values[i].size[1]*(this.Values[i].size[2] || 1))),(this.Values[i].size[2] || 1));
					idx += this.Values[i].size[0]*this.Values[i].size[1]*(this.Values[i].size[2] || 1);
				} else if (this.Values[i] instanceof self.Parameters) {
					this.Values[i].set(val.subarray(idx,idx+this.Values[i].ParameterCount));
					idx += this.Values[i].ParameterCount;
				}
			}
		}
		this.getValues = function() {
			var s = [];
			for (var i=0; i<this.Values.length; i++) {
				if (this.Values[i] instanceof self.Value) {
					s.push(this.Values[i]);
				} else if (this.Values[i] instanceof self.Parameters) {
					s.push(this.Values[i].getValues());
				}
			}
			return s.flat();
		}
	}
	this.Gradents = function(arr,layer) {
		this.Values = arr;
		this.Layer = layer;
		//if (layer && layer.ParameterCount) {
		//	this.Count = layer.ParameterCount || 0;
		//} else {
			this.Count = 0;
			for (var i=0; i<this.Values.length; i++) {
				if (this.Values[i] instanceof self.Value) {
					this.Count += this.Values[i].size[0]*this.Values[i].size[1]*(this.Values[i].size[2] || 1);
				} else if (this.Values[i] instanceof self.Gradents) {
					this.Count += this.Values[i].Count;
				}
			}
		//}
		this.clone = function() {
			var s = [];
			for (var i=0; i<this.Values.length; i++) {
				s.push(this.Values[i].clone());
			}
			return new self.State(s);
		}
		this.toArray = function() {
			var s = [];
			var len = 0;
			for (var i=0; i<this.Values.length; i++) {
				s.push(this.Values[i].toArray());
				len += s[i].length;
			}
			var result = new Float32Array(len);
			var idx = 0;
			for (var i=0; i<s.length; i++) {
				result.set(s[i],idx);
				idx += s[i].length;
			}
			return result;
			//if (this.Layer) {
			//	return result.slice(0,this.Layer.ParameterCount);
			//} else {
			//	return result;
			//}
		}
		this.set = function(val) {
			var s = [];
			var idx = 0;
			for (var i=0; i<this.Values.length; i++) {
				if (this.Values[i] instanceof self.Value) {
					this.Values[i].set(val.subarray(idx,idx+(this.Values[i].size[0]*this.Values[i].size[1]*(this.Values[i].size[2] || 1))),(this.Values[i].size[2] || 1));
					idx += this.Values[i].size[0]*this.Values[i].size[1]*(this.Values[i].size[2] || 1);
				} else if (this.Values[i] instanceof self.Parameters) {
					this.Values[i].set(val.subarray(idx,idx+this.Values[i].Count));
					idx += this.Values[i].Count;
				}
			}
		}
		this.getValues = function() {
			var s = [];
			for (var i=0; i<this.Values.length; i++) {
				if (this.Values[i] instanceof self.Value) {
					s.push(this.Values[i]);
				} else if (this.Values[i] instanceof self.Parameters) {
					s.push(this.Values[i].getValues());
				}
			}
			return s.flat();
		}
	}
    this.Programs = {
		RandomDense: createProgram(`#version 300 es
			uniform highp mat4 uRand;
            uniform highp float uM;
            const highp float PI = 3.1415926535897932384626433832795;
            const highp float Tau = PI * 2.0;
            highp vec4 seed = vec4(0.0,0.0,0.0,0.0);
            out highp vec4 fragColor;
            highp vec4 random() {
                highp uvec4 x = floatBitsToUint(seed*uRand);
                x = ((x>>8U)^x.ywzx)*110351524U;
                x = ((x>>8U)^x.ywzx)*110351524U;
                x = ((x>>8U)^x.ywzx)*110351524U;
				// seed = (vec4(x)+1.0)/4294967297.0;
				seed = (fract(vec4(x)/65536.0)*0.999969482421875)+0.0000152587890625;
                return seed;
            }
            highp vec4 randn() {
                highp vec4 r0 = random();
                highp vec4 r1 = random();
				seed = sqrt(-2.0*log(r0))*sin(Tau*r1);
                return seed;
            }
            void main(){
                seed = gl_FragCoord.xyzw-1.414;
				highp int y = int(gl_FragCoord.y-0.5);
				highp vec4 ran = randn();
				highp vec4 result = vec4(0.0);
				if (y > 0) {
					result = ran;
				} else {
					result.yzw = ran.xyz;
				}
				fragColor = result*uM;
            }
		`),
        Random: createProgram(`#version 300 es
			uniform highp mat4 uRand;
            uniform highp float uM;
            const highp float PI = 3.1415926535897932384626433832795;
            const highp float Tau = PI * 2.0;
            highp vec4 seed = vec4(0.0,0.0,0.0,0.0);
            out highp vec4 fragColor;
            highp vec4 random() {
                highp uvec4 x = floatBitsToUint(seed*uRand);
                x = ((x>>8U)^x.ywzx)*110351524U;
                x = ((x>>8U)^x.ywzx)*110351524U;
                x = ((x>>8U)^x.ywzx)*110351524U;
				// seed = (vec4(x)+1.0)/4294967297.0;
				seed = (fract(vec4(x)/65536.0)*0.999969482421875)+0.0000152587890625;
                return seed;
            }
            highp vec4 randn() {
                highp vec4 r0 = random();
                highp vec4 r1 = random();
				seed = sqrt(-2.0*log(r0))*sin(Tau*r1);
                return seed;
            }
            void main(){
                seed = gl_FragCoord.xyzw-1.414;
				fragColor = randn()*uM;
            }
		`),
        ConvolutionalPredict: createProgram(`#version 300 es
            uniform highp int uActivationFunction;
            uniform highp int uKerelSize;
            uniform highp sampler2D uInput;
            uniform highp sampler2D uWeights[3];
            uniform highp sampler2D uBias;
            out highp vec4 Activation;
            void main(){
                highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
                highp vec3 val = texelFetch(uBias,xy,0).xyz;
                highp int loop = uKerelSize*uKerelSize;
                highp ivec2 xyKerel = xy*uKerelSize;
                for (highp int i = 0; i < loop; i++){
                    highp ivec2 p = ivec2(i%uKerelSize,i/uKerelSize);
                    highp ivec2 pWeight = p+xyKerel;
                    highp ivec2 pInput = p+xy;
                    val += texelFetch(uInput,pInput,0).xyz*mat3(texelFetch(uWeights[0],pWeight,0).xyz,texelFetch(uWeights[1],pWeight,0).xyz,texelFetch(uWeights[2],pWeight,0).xyz);
                    //val += mat3(texelFetch(uWeights[0],pWeight,0).xyz,texelFetch(uWeights[1],pWeight,0).xyz,texelFetch(uWeights[2],pWeight,0).xyz)*texelFetch(uInput,pInput,0).xyz;
                }
                if (uActivationFunction == 1) {
                    val = max(val,vec3(0.0));
                }
				if (uActivationFunction == 2) {
                    val = tanh(val);
                }
				if (uActivationFunction == 3) {
                    val = 1.0/(1.0+exp(-val));
                }
                Activation = vec4(val,1.0);
            }
		`),
        ConvolutionalBackpropWaB: createProgram(`#version 300 es
            uniform highp int uKerelSize;
            uniform highp float uFactor;
            uniform highp sampler2D uGrad;
            uniform highp sampler2D uInput;
            out highp vec4 Activation[3];
            void main(){
                highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
                highp ivec2 filtr = xy/uKerelSize;
                highp ivec2 kern = xy%uKerelSize;
				highp int KerelSizeMone = uKerelSize-1;
                highp vec3 val = texelFetch(uGrad,filtr,0).xyz;
                highp vec3 I = texelFetch(uInput,filtr+kern,0).xyz;
				
                Activation[0] = vec4(I*val.x,uFactor);
                Activation[1] = vec4(I*val.y,uFactor);
                Activation[2] = vec4(I*val.z,uFactor);

				// Activation[0] = vec4(val*I.x,uFactor);
                // Activation[1] = vec4(val*I.y,uFactor);
                // Activation[2] = vec4(val*I.z,uFactor);
            }
		`),
        ConvolutionalBackprop: createProgram(`#version 300 es
            uniform highp int uKerelSize;
            uniform highp int uActivationFunction;
            uniform highp sampler2D uGrad;
            uniform highp sampler2D uWeights[3];
            uniform highp sampler2D uInput;
            out highp vec4 Activation;
            void main(){
                highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp int KerelSizeMone = uKerelSize-1;
				highp int KerelSizeDtwo = KerelSizeMone>>1;
                highp vec3 val;
                highp int loop = uKerelSize*uKerelSize;
                for (highp int i = 0; i < loop; i++){
                    highp ivec2 p = ivec2(i%uKerelSize,i/uKerelSize);
                    highp ivec2 pGrad = p+xy-KerelSizeMone;
					highp ivec2 pWeight = ((pGrad*uKerelSize)+(KerelSizeMone-p));
                    // val += texelFetch(uGrad,pGrad,0).xyz*mat3(texelFetch(uWeights[0],pWeight,0).xyz,texelFetch(uWeights[1],pWeight,0).xyz,texelFetch(uWeights[2],pWeight,0).xyz);
                    val += mat3(texelFetch(uWeights[0],pWeight,0).xyz,texelFetch(uWeights[1],pWeight,0).xyz,texelFetch(uWeights[2],pWeight,0).xyz)*texelFetch(uGrad,pGrad,0).xyz;
                }
                highp vec3 I = texelFetch(uInput,xy,0).xyz;
                if (uActivationFunction == 1) {
                    val *= sign(I);
                }
				if (uActivationFunction == 2) {
                    val *= 1.0-(I*I);
                }
				if (uActivationFunction == 3) {
                    val *= I*(1.0-I);
                }
                Activation = vec4(val,1.0);
            }
		`),
		AveragePooling: createProgram(`#version 300 es
            uniform highp int uLevel;
            uniform highp sampler2D uInput;
            out highp vec4 Activation;
            void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp vec3 val;
				highp int loop = uLevel*uLevel;
				highp ivec2 xyM = xy*uLevel;
                for (highp int i = 0; i < loop; i++){
					val += texelFetch(uInput,xyM+ivec2(i%uLevel,i/uLevel),0).xyz;
				}
                Activation = vec4(val/float(loop),1.0);
				// Activation = vec4(val,1.0);
            }
		`),
		AveragePoolingBackprop: createProgram(`#version 300 es
            uniform highp int uLevel;
			uniform highp int uActivationFunction;
            uniform highp sampler2D uGrad;
			uniform highp sampler2D uInput;
            out highp vec4 Activation;
            void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp vec3 val = texelFetch(uGrad,xy/uLevel,0).xyz/float(uLevel*uLevel);
				// highp vec3 val = texelFetch(uGrad,xy/uLevel,0).xyz;
				highp vec3 I = texelFetch(uInput,xy,0).xyz;
                if (uActivationFunction == 1) {
                    val *= sign(I);
                }
				if (uActivationFunction == 2) {
                    val *= 1.0-(I*I);
                }
				if (uActivationFunction == 3) {
                    val *= I*(1.0-I);
                }
                Activation = vec4(val,1.0);
            }
		`),
		Upscale: createProgram(`#version 300 es
            uniform highp int uLevel;
            uniform highp sampler2D uInput;
            out highp vec4 Activation;
            void main(){
                Activation = vec4(texelFetch(uInput,ivec2(gl_FragCoord.xy-0.5)/uLevel,0).xyz,1.0);
            }
		`),
		UpscaleBackprop: createProgram(`#version 300 es
            uniform highp int uLevel;
			uniform highp int uActivationFunction;
            uniform highp sampler2D uGrad;
			uniform highp sampler2D uInput;
            out highp vec4 Activation;
            void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp vec3 val;
				highp int loop = uLevel*uLevel;
				highp ivec2 xyM = xy*uLevel;
                for (highp int i = 0; i < loop; i++){
					val += texelFetch(uGrad,xyM+ivec2(i%uLevel,i/uLevel),0).xyz;
				}
				val /= float(loop);
				highp vec3 I = texelFetch(uInput,xy,0).xyz;
				if (uActivationFunction == 1) {
                    val *= sign(I);
                }
				if (uActivationFunction == 2) {
                    val *= 1.0-(I*I);
                }
				if (uActivationFunction == 3) {
                    val *= I*(1.0-I);
                }
                Activation = vec4(val,1.0);
            }
		`),
        BiasAdd: createProgram(`#version 300 es
            uniform highp sampler2D uGrad;
            uniform highp float uFactor;
            out highp vec4 Activation;
            void main(){
                Activation = vec4(texelFetch(uGrad,ivec2(gl_FragCoord.xy-0.5),0).xyz,uFactor);
            }
        `),
		Expand: createProgram(`#version 300 es
            uniform highp sampler2D uInput;
            uniform bool uVertical;
            out highp vec4 Activation;
            void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp int m;
				if (uVertical) {
					m = xy.y%3;
					xy.y /= 3;
				} else {
					m = xy.x%3;
					xy.x /= 3;
				}
                Activation = vec4(texelFetch(uInput,xy,0)[m]);
            }
        `),
		ExpandBackprop: createProgram(`#version 300 es
            uniform highp sampler2D uInput;
            uniform bool uVertical;
            out highp vec4 Activation;
            void main(){
				highp ivec2 xy0 = ivec2(gl_FragCoord.xy-0.5);
				highp ivec2 add;
				if (uVertical) {
					xy0.y *= 3;
					add = ivec2(0,1);
				} else {
					xy0.x *= 3;
					add = ivec2(1,0);
				}
				highp ivec2 xy1 = xy0+add;
				highp ivec2 xy2 = xy1+add;
                Activation = vec4(texelFetch(uInput,xy0,0).x,texelFetch(uInput,xy1,0).x,texelFetch(uInput,xy2,0).x,1.0);
            }
        `),
		Transpose: createProgram(`#version 300 es
            uniform highp sampler2D uInput;
            uniform bool uKeep;
            out highp vec4 Activation;
            void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.yx-0.5);
				if (uKeep) {
					xy.x = (xy.x*3)+(xy.y%3);
					xy.y /= 3;
					Activation = vec4(texelFetch(uInput,xy,0).xyz,1.0);
				} else {
					Activation = vec4(texelFetch(uInput,xy,0).xyz,1.0);
				}
            }
        `),
        Dense: createProgram(`#version 300 es
			uniform highp int uActivationFunction;
			uniform highp sampler2D uInp;
			uniform highp sampler2D uWaB;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp vec4 w = texelFetch(uWaB,ivec2(xy.x,0),0);
				highp float val = w.x;
				highp int uLayerInputTotal = textureSize(uInp,0)[0];
				for (highp int i = 0; i < uLayerInputTotal; i++){
					highp int y = (i+1)/4;
					highp int ym = (i+1)%4;
					if (ym == 0) {
						w = texelFetch(uWaB,ivec2(xy.x,y),0);
					}
					val += w[ym]*texelFetch(uInp,ivec2(i,xy.y),0).x;
				}
				if (uActivationFunction == 1) {
					val = max(val,0.0);
				}
				if (uActivationFunction == 2) {
					val = tanh(val);
				}
				if (uActivationFunction == 3) {
                    val = 1.0/(1.0+exp(-val));
                }
				Activation = vec4(val);
			}
		`),
		DenseBackprop: createProgram(`#version 300 es
			uniform highp sampler2D uGrad;
			uniform highp sampler2D uAct;
			uniform highp sampler2D uWaB;
			uniform highp int uActivationFunction;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp int y = (xy.x+1)>>2;
				highp int ym = (xy.x+1)&3;
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uWaB,0)[0];
				for (highp int i = 0; i < uLayerInputTotal; i++) {
					val += texelFetch(uWaB,ivec2(i,y),0)[ym]*texelFetch(uGrad,ivec2(i,xy.y),0).x;
				}
				highp float Act = texelFetch(uAct,xy,0).x;
				if (uActivationFunction == 1 && Act <= 0.0) {
                    val *= 0.0;
                }
				if (uActivationFunction == 2) {
                    val *= 1.0-(Act*Act);
                }
				if (uActivationFunction == 3) {
                    val *= Act*(1.0-Act);
                }
				Activation = vec4(val);
			}
		`),
		DenseBackpropWaB: createProgram(`#version 300 es
			uniform highp sampler2D uGrad;
			uniform highp sampler2D uInp;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp vec4 val = vec4(0.0);
				highp int uLayerInputTotal = textureSize(uGrad,0)[1];
				highp ivec4 y = ivec4(xy.y*4)+ivec4(-1,0,1,2);
				if (y.x == -1) {
					for (highp int i = 0; i < uLayerInputTotal; i++){
						// val.x += texelFetch(uGrad,ivec2(xy.x,i),0).x;
						// val.y += texelFetch(uInp,ivec2(y.y,i),0).x*texelFetch(uGrad,ivec2(xy.x,i),0).x;
						// val.z += texelFetch(uInp,ivec2(y.z,i),0).x*texelFetch(uGrad,ivec2(xy.x,i),0).x;
						// val.w += texelFetch(uInp,ivec2(y.w,i),0).x*texelFetch(uGrad,ivec2(xy.x,i),0).x;
						highp float g = texelFetch(uGrad,ivec2(xy.x,i),0).x;
						val += vec4(1.0,texelFetch(uInp,ivec2(y.y,i),0).x,texelFetch(uInp,ivec2(y.z,i),0).x,texelFetch(uInp,ivec2(y.w,i),0).x)*g;
					}
				} else {
					for (highp int i = 0; i < uLayerInputTotal; i++){
						// val.x += texelFetch(uInp,ivec2(y.x,i),0).x*texelFetch(uGrad,ivec2(xy.x,i),0).x;
						// val.y += texelFetch(uInp,ivec2(y.y,i),0).x*texelFetch(uGrad,ivec2(xy.x,i),0).x;
						// val.z += texelFetch(uInp,ivec2(y.z,i),0).x*texelFetch(uGrad,ivec2(xy.x,i),0).x;
						// val.w += texelFetch(uInp,ivec2(y.w,i),0).x*texelFetch(uGrad,ivec2(xy.x,i),0).x;
						highp float g = texelFetch(uGrad,ivec2(xy.x,i),0).x;
						val += vec4(texelFetch(uInp,ivec2(y.x,i),0).x,texelFetch(uInp,ivec2(y.y,i),0).x,texelFetch(uInp,ivec2(y.z,i),0).x,texelFetch(uInp,ivec2(y.w,i),0).x)*g;
					}
				}
				Activation = val;
			}
		`),
		AddWaB: createProgram(`#version 300 es
			uniform highp sampler2D uWaBdelta;
			uniform highp float uFactor;
			out highp vec4 Activation;
			void main(){
				Activation = texelFetch(uWaBdelta,ivec2(gl_FragCoord.xy-0.5),0)*uFactor;
			}
		`),
		CalcGrad3D: createProgram(`#version 300 es
			uniform highp sampler2D uGoal;
			uniform highp sampler2D uResult;
			uniform highp int uActivationFunction;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp vec3 Inp = texelFetch(uResult,xy,0).xyz;
				highp vec3 Gol = texelFetch(uGoal,xy,0).xyz;
				highp vec3 val = (Gol-Inp)*2.0;
				// highp vec3 val = (Inp-Gol)*2.0;
				if (uActivationFunction == 1) {
                    val *= max(sign(Inp),vec3(0.1));
                }
				if (uActivationFunction == 2) {
                    val *= max(1.0-(Inp*Inp),vec3(0.1));
                }
				if (uActivationFunction == 3) {
                    val *= max(Inp*(1.0-Inp),vec3(0.025));
                }
				highp ivec2 res = textureSize(uResult,0);
				Activation = vec4(val/sqrt(float(res[0]*res[1])),1.0);
			}
		`),
		Flatten: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform bool uNo3D;
			out highp vec4 Activation;
			void main() {
				highp int x = int(gl_FragCoord.x-0.5);
				highp ivec2 res = textureSize(uInput,0);
				highp ivec3 pos = ivec3(0);
				if (!uNo3D) {
					pos.z = x%3;
					x /= 3;
				}
				pos.x = x%res[0];
				pos.y = x/res[0];
				Activation = vec4(texelFetch(uInput,pos.xy,0)[pos.z]);
			}
		`),
		UnFlatten: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform highp int uWidth;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp int x = ((xy.y*uWidth)+xy.x)*3;
				Activation = vec4(texelFetch(uInput,ivec2(x,0),0).x,texelFetch(uInput,ivec2(x+1,0),0).x,texelFetch(uInput,ivec2(x+2,0),0).x,1.0);
			}
		`),
		Subtract: createProgram(`#version 300 es
			uniform highp sampler2D uInput0;
			uniform highp sampler2D uInput1;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				Activation = vec4(texelFetch(uInput0,xy,0).xyz-texelFetch(uInput1,xy,0).xyz,1.0);
			}
		`),
		Concat: createProgram(`#version 300 es
			uniform highp sampler2D uInput0;
			uniform highp sampler2D uInput1;
			uniform bool uVertical;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp ivec2 res0 = textureSize(uInput0,0);
				highp ivec2 res1 = textureSize(uInput1,0);
				if (uVertical) {
					highp int hei = res0[1];
					if (xy.y < hei) {
						Activation = texelFetch(uInput0,xy,0);
					} else {
						Activation = texelFetch(uInput1,xy-ivec2(0,hei),0);
					}
				} else {
					highp int wid = res0[0];
					if (xy.x < wid) {
						Activation = texelFetch(uInput0,xy,0);
					} else {
						Activation = texelFetch(uInput1,xy-ivec2(wid,0),0);
					}
				}
			}
		`),
		Split: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform highp int uWidth;
			uniform bool uVertical;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				if (uVertical) {
					Activation = texelFetch(uInput,xy+ivec2(0,uWidth),0);
				} else {
					Activation = texelFetch(uInput,xy+ivec2(uWidth,0),0);
				}
			}
		`),
		Shift: createProgram(`#version 300 es
			uniform highp sampler2D uInput0;
			uniform highp sampler2D uInput1;
			uniform bool uHorizontal;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				if (uHorizontal) {
					highp int wid = textureSize(uInput0,0)[0];
					if (xy.x < wid) {
						Activation = texelFetch(uInput0,xy,0);
					} else {
						Activation = texelFetch(uInput1,xy-ivec2(wid,0),0);
					}
				} else {
					highp int wid = textureSize(uInput0,0)[1];
					if (xy.y < wid) {
						Activation = texelFetch(uInput0,xy,0);
					} else {
						Activation = texelFetch(uInput1,xy-ivec2(0,wid),0);
					}
				}
			}
		`),
        AttentionDotExp: createProgram(`#version 300 es
			uniform highp sampler2D uQ;
			uniform highp sampler2D uK;
			uniform highp float uMult;
			uniform highp float uConstMult;
			uniform bool uMask;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uQ,0)[0];
				highp int Qweries = textureSize(uQ,0)[1];
				highp int Keys = textureSize(uK,0)[1];
				if (Keys-xy.x >= Qweries-xy.y || !uMask) {
					for (highp int i = 0; i < uLayerInputTotal; i++) {
						val += texelFetch(uQ,ivec2(i,xy.y),0).x*texelFetch(uK,ivec2(i,xy.x),0).x;
					}
					// val = exp((val-8.0)*uMult);
					val -= float(abs((Qweries-xy.y)-(Keys-xy.x)))*uConstMult;
					// val = exp(clamp(val*uMult,-5.0,5.0));
					val = exp(clamp(val*uMult,-24.0,24.0));
					//val = exp(val*uMult/sqrt(float(Keys-xy.x)));
					Activation = vec4(val);
				} else {
					Activation = vec4(val);
				}
			}
		`),
		AttentionSum: createProgram(`#version 300 es
			uniform highp sampler2D uMat;
			out highp vec4 Activation;
			void main(){
				highp int y = int(gl_FragCoord.y-0.5);
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uMat,0)[0];
				for (highp int i = 0; i < uLayerInputTotal; i++){
					val += texelFetch(uMat,ivec2(i,y),0).x;
				}
				Activation = vec4(val);
			}
		`),
		AttentionDivide: createProgram(`#version 300 es
			uniform highp sampler2D uDotExps;
			uniform highp sampler2D uDotExpSums;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				Activation = texelFetch(uDotExps,xy,0)/texelFetch(uDotExpSums,ivec2(0,xy.y),0).x;
			}
		`),
		AttentionValueDot: createProgram(`#version 300 es
			uniform highp sampler2D uV;
			uniform highp sampler2D uWeights;
			uniform highp sampler2D uQ;
			uniform bool uResid;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uWeights,0)[0];
				for (highp int i = 0; i < uLayerInputTotal; i++) {
					val += texelFetch(uV,ivec2(xy.x,i),0).x*texelFetch(uWeights,ivec2(i,xy.y),0).x;
				}
				// val += texelFetch(uV,xy,0).x;
				if (uResid) {
					val += texelFetch(uQ,xy,0).x;
				}
				Activation = vec4(val);
			}
		`),
		AttentionBackpropValue: createProgram(`#version 300 es
			uniform highp sampler2D uV;
			uniform highp sampler2D uGrad;
			uniform highp sampler2D uWeights;
			uniform highp sampler2D uQ;
			uniform bool uResid;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uWeights,0)[1];
				for (highp int i = 0; i < uLayerInputTotal; i++) {
					//val += texelFetch(uGrad,ivec2(i,xy.y),0).x*texelFetch(uWeights,ivec2(xy.x,i),0).x;
					// val += texelFetch(uGrad,ivec2(xy.x,i),0).x*texelFetch(uWeights,ivec2(i,xy.y),0).x;
					val += texelFetch(uGrad,ivec2(xy.x,i),0).x*texelFetch(uWeights,ivec2(xy.y,i),0).x;
				}
				if (uResid) {
					val += texelFetch(uGrad,xy,0).x;
				}
				// highp float Act = texelFetch(uV,xy,0).x;
				//val *= max(1.0-(Act*Act),0.0);
				//val *= max(1.5-(Act*Act),0.0);
				Activation = vec4(val);
			}
		`),
		AttentionBackpropWeights: createProgram(`#version 300 es
			uniform highp sampler2D uV;
			uniform highp sampler2D uGrad;
			uniform highp sampler2D uWeights;
			uniform highp float uMult;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uGrad,0)[0];
				for (highp int i = 0; i < uLayerInputTotal; i++) {
					//val += texelFetch(uV,ivec2(i,xy.y),0).x*texelFetch(uGrad,ivec2(i,xy.x),0).x;
					val += texelFetch(uV,ivec2(i,xy.x),0).x*texelFetch(uGrad,ivec2(i,xy.y),0).x;
				}
				Activation = vec4(val*uMult);
			}
		`),
		AttentionBackpropWeightsJacobianSumOp: createProgram(`#version 300 es
			uniform highp sampler2D uGrad;
			uniform highp sampler2D uWeights;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = 0.0;
				highp int Wid = textureSize(uWeights,0)[0];
				for (highp int i = 0; i < Wid; i++) {
					// val += texelFetch(uGrad,ivec2(i,xy.y),0).x*(1.0-texelFetch(uWeights,ivec2(i,xy.y),0).x);
					val += texelFetch(uGrad,ivec2(i,xy.y),0).x*texelFetch(uWeights,ivec2(i,xy.y),0).x;
				}
				Activation = vec4(val);
			}
		`),
		AttentionBackpropWeightsJacobian: createProgram(`#version 300 es
			uniform highp sampler2D uGrad;
			uniform highp sampler2D uWeights;
			uniform highp sampler2D uJacobianSumOp;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = -texelFetch(uJacobianSumOp,ivec2(0,xy.y),0).x;
				highp float g = texelFetch(uGrad,xy,0).x;
				highp float w = texelFetch(uWeights,xy,0).x;
				val += g*w;
				val += g*(1.0-w);
				val *= w;
				Activation = vec4(val);
			}
		`),
		AttentionBackpropQuery: createProgram(`#version 300 es
			uniform highp sampler2D uQ;
			uniform highp sampler2D uK;
			uniform highp sampler2D uWeightsGrad;
			uniform highp sampler2D uGrad;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uWeightsGrad,0)[0];
				for (highp int i = 0; i < uLayerInputTotal; i++) {
					val += texelFetch(uK,ivec2(xy.x,i),0).x*texelFetch(uWeightsGrad,ivec2(i,xy.y),0).x;
					//val += texelFetch(uK,ivec2(xy.x,i),0).x*texelFetch(uWeightsGrad,ivec2(xy.y,i),0).x;
				}
				val += texelFetch(uGrad,xy,0).x;
				// highp float Act = texelFetch(uQ,xy,0).x;
				//val *= max(1.0-(Act*Act),0.0);
				//val *= max(1.5-(Act*Act),0.0);
				Activation = vec4(val);
			}
		`),
		AttentionBackpropKey: createProgram(`#version 300 es
			uniform highp sampler2D uQ;
			uniform highp sampler2D uK;
			uniform highp sampler2D uWeightsGrad;
			uniform highp sampler2D uGrad;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uWeightsGrad,0)[1];
				for (highp int i = 0; i < uLayerInputTotal; i++) {
					val += texelFetch(uQ,ivec2(xy.x,i),0).x*texelFetch(uWeightsGrad,ivec2(xy.y,i),0).x;
					//val += texelFetch(uQ,ivec2(xy.x,i),0).x*texelFetch(uWeightsGrad,ivec2(i,xy.y),0).x;
				}
				//val += texelFetch(uGrad,xy,0).x;
				// highp float Act = texelFetch(uK,xy,0).x;
				//val *= max(1.0-(Act*Act),0.0);
				//val *= max(1.5-(Act*Act),0.0);
				Activation = vec4(val);
			}
		`),
		Tokenize: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform highp int uSize;
			out highp vec4 Activation;
			highp float posEncode(highp vec2 xy) {
				return 0.3849001794597505*(sin(xy[0]*4.1887902047863905)+sin((3.6275987284684357*xy[1])-(2.0943951023931953*xy[0]))-sin((3.6275987284684357*xy[1])+(2.0943951023931953*xy[0])));
			}
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp ivec2 res = textureSize(uInput,0)/uSize;
				highp ivec2 posSizeDiv = ivec2(xy.y%res.x,xy.y/res.x);
				highp ivec2 posSize = posSizeDiv*uSize;

				highp vec2 p = (vec2(posSizeDiv)+0.5)/(vec2(res)+1.0);
				// p *= float(1<<(xy.x/3));
				p *= float(xy.x/3);
				p.x += float(xy.x%3);
				
				highp ivec3 pos;
				pos.z = xy.x%3;
				xy.x /= 3;
				pos.x = (xy.x%uSize)+posSize.x;
				pos.y = (xy.x/uSize)+posSize.y;
				Activation = vec4(texelFetch(uInput,pos.xy,0)[pos.z]+posEncode(p));
			}
		`),
		TokenizeBackprop: createProgram(`#version 300 es
			uniform highp sampler2D uGrad;
			uniform highp sampler2D uInput;
			uniform highp int uWidth;
			uniform highp int uSize;
			uniform highp int uActivationFunction;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp ivec2 res = textureSize(uGrad,0);
				highp ivec2 posSizeDiv = xy/uSize;
				highp ivec2 posSize = posSizeDiv*uSize;
				highp ivec2 posMod = xy-posSize;
				highp ivec2 pos = ivec2((posMod.x+(posMod.y*uSize))*3,posSizeDiv.x+(posSizeDiv.y*(uWidth/uSize)));
				highp vec3 val = vec3(texelFetch(uGrad,pos,0).x,texelFetch(uGrad,pos+ivec2(1,0),0).x,texelFetch(uGrad,pos+ivec2(2,0),0).x);
				highp vec3 Act = texelFetch(uInput,xy,0).xyz;
				if (uActivationFunction == 1) {
                    val *= max(sign(Act),vec3(0.0));
                }
				if (uActivationFunction == 2) {
                    val *= max(1.0-(Act*Act),vec3(0.0));
                }
				if (uActivationFunction == 3) {
                    val *= max(Act*(1.0-Act),vec3(0.0));
                }
				Activation = vec4(val,1.0);
			}
		`),
		Display: createProgram(`#version 300 es
            uniform highp sampler2D uInput;
            out highp vec4 Activation;
            void main(){
                Activation = texelFetch(uInput,ivec2(gl_FragCoord.xy-0.5),0);
            }
        `),
		LayerMean: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			out highp vec4 Activation;
			void main(){
				//highp int x = int(gl_FragCoord.x-0.5);
				highp int y = int(gl_FragCoord.y-0.5);
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uInput,0)[0];
				for (highp int i = 0; i < uLayerInputTotal; i++) {
					//val += texelFetch(uInput,ivec2(x,i),0).x;
					val += texelFetch(uInput,ivec2(i,y),0).x;
				}
				Activation = vec4(val/float(uLayerInputTotal));
			}
        `),
		LayerMeanSubtract: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform highp sampler2D uMean;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				//Activation = vec4(texelFetch(uInput,xy,0).x-texelFetch(uMean,ivec2(xy.x,0),0).x);
				Activation = vec4(texelFetch(uInput,xy,0).x-texelFetch(uMean,ivec2(0,xy.y),0).x);
			}
        `),
		LayerVariance: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			out highp vec4 Activation;
			void main(){
				highp int y = int(gl_FragCoord.y-0.5);
				highp float val = 0.0;
				highp int uLayerInputTotal = textureSize(uInput,0)[0];
				for (highp int i = 0; i < uLayerInputTotal; i++) {
					highp float v = texelFetch(uInput,ivec2(i,y),0).x;
					val += v*v;
				}
				val /= float(uLayerInputTotal);
				Activation = vec4(sqrt(val+1e-7));
			}
        `),
		LayerVarianceDivide: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform highp sampler2D uVariance;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				Activation = vec4(texelFetch(uInput,xy,0).x/texelFetch(uVariance,ivec2(0,xy.y),0).x);
			}
        `),
		LayerNormBackprop: createProgram(`#version 300 es
			uniform highp sampler2D uGrad;
			uniform highp sampler2D uInput;
			uniform highp sampler2D uVariance;
			uniform highp int uActivationFunction;
			out highp vec4 Activation;
			void main(){
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float Act = texelFetch(uInput,xy,0).x;
				highp float val = texelFetch(uGrad,xy,0).x/texelFetch(uVariance,ivec2(0,xy.y),0).x;
				if (uActivationFunction == 1 && Act <= 0.0) {
                    val *= 0.0;
                }
				if (uActivationFunction == 2) {
                    val *= 1.0-(Act*Act);
                }
				if (uActivationFunction == 3) {
                    val *= Act*(1.0-Act);
                }
				Activation = vec4(val);
			}
        `),
		IndexStamp: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform bool uVertical;
			out highp vec4 Activation;
			const highp float Pi = 3.14159265358979;
			const highp float Pi2 = Pi*0.5;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				if (uVertical) {
					highp float d = float(textureSize(uInput,0)[0]);
					if (xy.y%2 == 1) {
						Activation = texelFetch(uInput,xy,0)+cos((float(xy.x))*Pi*pow(65536.0,-float(xy.y>>1)/d));
						// Activation = texelFetch(uInput,xy,0)+vec4(cos((uTime+float(xy.x))*Pi));
					} else {
						Activation = texelFetch(uInput,xy,0)+sin((float(xy.x))*Pi*pow(65536.0,-float(xy.y>>1)/d));
						// Activation = texelFetch(uInput,xy,0)+vec4(sin((uTime+float(xy.x))*Pi));
					}
				} else {
					highp float d = float(textureSize(uInput,0)[1]);
					if (xy.x%2 == 1) {
						Activation = texelFetch(uInput,xy,0)+cos((float(xy.y))*Pi*pow(65536.0,-float(xy.x>>1)/d));
						// Activation = texelFetch(uInput,xy,0)+vec4(cos((uTime+float(xy.y))*Pi));
					} else {
						Activation = texelFetch(uInput,xy,0)+sin((float(xy.y))*Pi*pow(65536.0,-float(xy.x>>1)/d));
						// Activation = texelFetch(uInput,xy,0)+vec4(sin((uTime+float(xy.y))*Pi));
					}
				}
			}
        `),
		Repeat: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			out highp vec4 Activation;
			void main(){
				highp int x = int(gl_FragCoord.x-0.5);
				Activation = texelFetch(uInput,ivec2(x,0),0);
			}
        `),
		RepeatBackprop: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			out highp vec4 Activation;
			void main(){
				highp int x = int(gl_FragCoord.x-0.5);
				highp int loop = textureSize(uInput,0)[1];
				highp float val = 0.0;
				for (highp int i=0; i<loop; i++) {
					val += texelFetch(uInput,ivec2(x,i),0).x;
				}
				Activation = vec4(val);
			}
        `),
		FourierRU: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform highp sampler2D uFreqPhases;
			uniform highp float Factor;
			uniform highp float Time;
			out highp vec4 Activation;
			const highp float Pi = 3.14159265358979;
			const highp float Tau = 2.0*Pi;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = texelFetch(uInput,xy,0).x;
				highp vec2 fp = texelFetch(uFreqPhases,ivec2(xy.x,0),0).xy;
				val *= cos((Tau*Time*fp.x)+fp.y);
				Activation = vec4(val,val,val,Factor);
			}
        `),
		FourierRUBackprop: createProgram(`#version 300 es
			uniform highp sampler2D uGrad;
			uniform highp sampler2D uInput;
			uniform highp sampler2D uFreqPhases;
			uniform highp int uActivationFunction;
			uniform highp float Time;
			out highp vec4 Activation;
			const highp float Pi = 3.14159265358979;
			const highp float Tau = 2.0*Pi;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp float val = texelFetch(uGrad,xy,0).x;
				highp vec2 fp = texelFetch(uFreqPhases,ivec2(xy.x,0),0).xy;
				val *= -sin((Tau*Time*fp.x)+fp.y);
				highp float Act = texelFetch(uInput,xy,0).x;
				if (uActivationFunction == 1 && Act <= 0.0) {
                    val *= 0.0;
                }
				if (uActivationFunction == 2) {
                    val *= 1.0-(Act*Act);
                }
				if (uActivationFunction == 3) {
                    val *= Act*(1.0-Act);
                }
				Activation = vec4(val);
			}
        `),
		PointMultiply: createProgram(`#version 300 es
			uniform highp sampler2D uInput0;
			uniform highp sampler2D uInput1;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				Activation = texelFetch(uInput0,xy,0)*texelFetch(uInput1,xy,0);
			}
        `),
		Lerp: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform highp sampler2D uTval;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				Activation = vec4(texelFetch(uInput,xy,0).xyz,texelFetch(uTval,xy,0).x);
			}
        `),
		LerpBackrop: createProgram(`#version 300 es
			uniform highp sampler2D uInput0;
			uniform highp sampler2D uInput1;
			uniform highp sampler2D uGrad;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				Activation = (texelFetch(uInput1,xy,0)-texelFetch(uInput0,xy,0))*texelFetch(uGrad,xy,0);
			}
        `),
		EleDropout: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform highp mat4 uRand;
			uniform highp int uCount;
			uniform highp float uHeight;
			out highp vec4 Activation;
			highp vec4 seed = vec4(3.141,2.71,1.414,0.0);
			highp vec4 random() {
				highp uvec4 x = floatBitsToUint(seed*uRand);
				x = ((x>>8U)^x.ywzx)*110351524U;
				x = ((x>>8U)^x.ywzx)*110351524U;
				x = ((x>>8U)^x.ywzx)*110351524U;
				seed = (fract(vec4(x)/65536.0)*0.999969482421875)+0.0000152587890625;
				return seed;
			}
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				highp int offset = 0;
				for (highp int i=0; i<uCount; i++) {
					if (int(random()[0]*uHeight) < xy.y) {
						offset++;
					}
				}
				xy.y += offset;
				Activation = texelFetch(uInput,xy,0);
			}
        `),
		IndexStampTimed: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			uniform bool uVertical;
			uniform highp float uTime;
			out highp vec4 Activation;
			const highp float Pi = 3.14159265358979;
			const highp float Pi2 = Pi*0.5;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				if (uVertical) {
					highp float d = float(textureSize(uInput,0)[0]);
					if (xy.y%2 == 1) {
						Activation = texelFetch(uInput,xy,0)+cos((uTime+float(xy.x))*Pi*pow(65536.0,-float(xy.y>>1)/d));
						// Activation = texelFetch(uInput,xy,0)+vec4(cos((uTime+float(xy.x))*Pi));
					} else {
						Activation = texelFetch(uInput,xy,0)+sin((uTime+float(xy.x))*Pi*pow(65536.0,-float(xy.y>>1)/d));
						// Activation = texelFetch(uInput,xy,0)+vec4(sin((uTime+float(xy.x))*Pi));
					}
				} else {
					highp float d = float(textureSize(uInput,0)[1]);
					if (xy.x%2 == 1) {
						Activation = texelFetch(uInput,xy,0)+cos((uTime+float(xy.y))*Pi*pow(65536.0,-float(xy.x>>1)/d));
						// Activation = texelFetch(uInput,xy,0)+vec4(cos((uTime+float(xy.y))*Pi));
					} else {
						Activation = texelFetch(uInput,xy,0)+sin((uTime+float(xy.y))*Pi*pow(65536.0,-float(xy.x>>1)/d));
						// Activation = texelFetch(uInput,xy,0)+vec4(sin((uTime+float(xy.y))*Pi));
					}
				}
			}
        `),
		SoftMaxExp: createProgram(`#version 300 es
			uniform highp sampler2D uInput;
			out highp vec4 Activation;
			void main() {
				highp ivec2 xy = ivec2(gl_FragCoord.xy-0.5);
				Activation = vec4(exp(texelFetch(uInput,xy,0).x));
			}
        `),
	};
	this.gl.useProgram(this.Programs.IndexStampTimed);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.IndexStampTimed, "uInput"), 0);
	this.IndexStampTimedTime = this.gl.getUniformLocation(this.Programs.IndexStampTimed, "uTime");
	this.IndexStampTimedVertical = this.gl.getUniformLocation(this.Programs.IndexStampTimed, "uVertical");

	this.gl.useProgram(this.Programs.EleDropout);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.EleDropout, "uInput"), 0);
	this.EleDropoutOffsetRand = this.gl.getUniformLocation(this.Programs.EleDropout, "uRand");
	this.EleDropoutOffsetCount = this.gl.getUniformLocation(this.Programs.EleDropout, "uCount");
	this.EleDropoutOffsetHeight = this.gl.getUniformLocation(this.Programs.EleDropout, "uHeight");

	this.gl.useProgram(this.Programs.LerpBackrop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LerpBackrop, "uInput0"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LerpBackrop, "uInput1"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LerpBackrop, "uGrad"), 2);

	this.gl.useProgram(this.Programs.Lerp);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Lerp, "uInput"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Lerp, "uTval"), 1);

    this.uMDense = this.gl.getUniformLocation(this.Programs.RandomDense, "uM");
	this.uRandomDense = this.gl.getUniformLocation(this.Programs.RandomDense, "uRand");
    this.uM = this.gl.getUniformLocation(this.Programs.Random, "uM");
	this.uRandom = this.gl.getUniformLocation(this.Programs.Random, "uRand");
    this.gl.useProgram(this.Programs.ConvolutionalPredict);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.ConvolutionalPredict, "uInput"), 0);
	this.gl.uniform1iv(this.gl.getUniformLocation(this.Programs.ConvolutionalPredict, "uWeights"), [1,2,3]);
    this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.ConvolutionalPredict, "uBias"), 4);
    this.ConvolutionalActivationFunction = this.gl.getUniformLocation(this.Programs.ConvolutionalPredict, "uActivationFunction");
    this.ConvolutionalKernelSize = this.gl.getUniformLocation(this.Programs.ConvolutionalPredict, "uKerelSize");
    this.gl.useProgram(this.Programs.BiasAdd);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.BiasAdd, "uGrad"), 0);
    this.uFactor = this.gl.getUniformLocation(this.Programs.BiasAdd, "uFactor");
	
	this.gl.useProgram(this.Programs.Expand);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Expand, "uInput"), 0);
    this.ExpandVertical = this.gl.getUniformLocation(this.Programs.Expand, "uVertical");
	
	this.gl.useProgram(this.Programs.ExpandBackprop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.ExpandBackprop, "uGrad"), 0);
    this.ExpandBackpropVertical = this.gl.getUniformLocation(this.Programs.ExpandBackprop, "uVertical");
	
	this.gl.useProgram(this.Programs.Transpose);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Transpose, "uInput"), 0);
    this.TransposeKeep3D = this.gl.getUniformLocation(this.Programs.Transpose, "uKeep");
	
    this.gl.useProgram(this.Programs.ConvolutionalBackpropWaB);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.ConvolutionalBackpropWaB, "uGrad"), 0);
    this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.ConvolutionalBackpropWaB, "uInput"), 1);
    this.ConvolutionalBackpropWaBKernelSize = this.gl.getUniformLocation(this.Programs.ConvolutionalBackpropWaB, "uKerelSize");
    this.ConvolutionalBackpropFactor = this.gl.getUniformLocation(this.Programs.ConvolutionalBackpropWaB, "uFactor");
    this.gl.useProgram(this.Programs.ConvolutionalBackprop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.ConvolutionalBackprop, "uGrad"), 0);
    this.gl.uniform1iv(this.gl.getUniformLocation(this.Programs.ConvolutionalBackprop, "uWeights"), [1,2,3]);
    this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.ConvolutionalBackprop, "uInput"), 4);
    this.ConvolutionalBackpropKernelSize = this.gl.getUniformLocation(this.Programs.ConvolutionalBackprop, "uKerelSize");
    this.ConvolutionalBackpropActivationFunction = this.gl.getUniformLocation(this.Programs.ConvolutionalBackprop, "uActivationFunction");
	
	this.gl.useProgram(this.Programs.AveragePooling);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AveragePooling, "uInput"), 0);
    this.AveragePoolingLevel = this.gl.getUniformLocation(this.Programs.AveragePooling, "uLevel");
	this.gl.useProgram(this.Programs.AveragePoolingBackprop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AveragePoolingBackprop, "uGrad"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AveragePoolingBackprop, "uInput"), 1);
    this.AveragePoolingBackpropLevel = this.gl.getUniformLocation(this.Programs.AveragePoolingBackprop, "uLevel");
	this.AveragePoolingBackpropActivationFunction = this.gl.getUniformLocation(this.Programs.AveragePoolingBackprop, "uActivationFunction");
	
	this.gl.useProgram(this.Programs.Upscale);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Upscale, "uInput"), 0);
    this.UpscaleLevel = this.gl.getUniformLocation(this.Programs.Upscale, "uLevel");
	
	this.gl.useProgram(this.Programs.UpscaleBackprop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.UpscaleBackprop, "uGrad"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.UpscaleBackprop, "uInput"), 1);
    this.UpscaleBackpropLevel = this.gl.getUniformLocation(this.Programs.UpscaleBackprop, "uLevel");
	this.UpscaleBackpropActivationFunction = this.gl.getUniformLocation(this.Programs.UpscaleBackprop, "uActivationFunction");

	this.gl.useProgram(this.Programs.PointMultiply);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.PointMultiply, "uInput0"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.PointMultiply, "uInput1"), 1);
	
    this.gl.useProgram(this.Programs.Dense);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Dense, "uWaB"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Dense, "uInp"), 1);
    this.DenseActivationFunction = this.gl.getUniformLocation(this.Programs.Dense, "uActivationFunction");
	this.gl.useProgram(this.Programs.DenseBackprop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.DenseBackprop, "uGrad"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.DenseBackprop, "uAct"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.DenseBackprop, "uWaB"), 2);
	this.DenseBackpropActivationFunction = this.gl.getUniformLocation(this.Programs.DenseBackprop, "uActivationFunction");
	this.gl.useProgram(this.Programs.DenseBackpropWaB);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.DenseBackpropWaB, "uGrad"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.DenseBackpropWaB, "uInp"), 1);
	
	this.gl.useProgram(this.Programs.CalcGrad3D);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.CalcGrad3D, "uGoal"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.CalcGrad3D, "uResult"), 1);
	this.CalcGrad3DActivationFunction = this.gl.getUniformLocation(this.Programs.CalcGrad3D, "uActivationFunction");
	
	this.gl.useProgram(this.Programs.AddWaB);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AddWaB, "uWaBdelta"), 0);
	this.uFactor2 = this.gl.getUniformLocation(this.Programs.AddWaB, "uFactor");
	
	this.gl.useProgram(this.Programs.Flatten);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Flatten, "uInput"), 0);
	this.FlattenNo3D = this.gl.getUniformLocation(this.Programs.Flatten, "uNo3D");
	
	this.gl.useProgram(this.Programs.UnFlatten);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.UnFlatten, "uInput"), 0);
	this.uWidth = this.gl.getUniformLocation(this.Programs.UnFlatten, "uWidth");

	this.gl.useProgram(this.Programs.Subtract);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Subtract, "uInput0"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Subtract, "uInput1"), 1);
	
	this.gl.useProgram(this.Programs.Concat);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Concat, "uInput0"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Concat, "uInput1"), 1);
	this.ConcatVertical = this.gl.getUniformLocation(this.Programs.Concat, "uVertical");
	// uVertical
	
	this.gl.useProgram(this.Programs.Split);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Split, "uInput"), 0);
	this.SplitWidth = this.gl.getUniformLocation(this.Programs.Split, "uWidth");
	this.SplitVertical = this.gl.getUniformLocation(this.Programs.Split, "uVertical");
	// uVertical

	// Shift
	this.gl.useProgram(this.Programs.Shift);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Shift, "uInput0"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Shift, "uInput1"), 1);
	this.ShiftHorizontal = this.gl.getUniformLocation(this.Programs.Shift, "uHorizontal");

    this.gl.useProgram(this.Programs.AttentionDotExp);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionDotExp, "uQ"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionDotExp, "uK"), 1);
	this.uMult = this.gl.getUniformLocation(this.Programs.AttentionDotExp, "uMult");
	this.uMask = this.gl.getUniformLocation(this.Programs.AttentionDotExp, "uMask");
	this.uConstMult = this.gl.getUniformLocation(this.Programs.AttentionDotExp, "uConstMult");
	this.gl.useProgram(this.Programs.AttentionSum);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionSum, "uMat"), 0);
	this.gl.useProgram(this.Programs.AttentionDivide);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionDivide, "uDotExps"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionDivide, "uDotExpSums"), 1);
	this.gl.useProgram(this.Programs.AttentionValueDot);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionValueDot, "uV"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionValueDot, "uWeights"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionValueDot, "uQ"), 2);
	this.AttentionResid = this.gl.getUniformLocation(this.Programs.AttentionValueDot, "uResid");
	this.gl.useProgram(this.Programs.AttentionBackpropValue);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropValue, "uV"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropValue, "uGrad"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropValue, "uWeights"), 2);
	this.AttentionBackpropResid = this.gl.getUniformLocation(this.Programs.AttentionBackpropValue, "uResid");
	this.gl.useProgram(this.Programs.AttentionBackpropWeights);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropWeights, "uV"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropWeights, "uGrad"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropWeights, "uWeights"), 2);
	this.uMult2 = this.gl.getUniformLocation(this.Programs.AttentionBackpropWeights, "uMult");
	this.gl.useProgram(this.Programs.AttentionBackpropWeightsJacobianSumOp);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropWeightsJacobianSumOp, "uGrad"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropWeightsJacobianSumOp, "uWeights"), 1);
	this.gl.useProgram(this.Programs.AttentionBackpropWeightsJacobian);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropWeightsJacobian, "uGrad"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropWeightsJacobian, "uWeights"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropWeightsJacobian, "uJacobianSumOp"), 2);
	this.gl.useProgram(this.Programs.AttentionBackpropQuery);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropQuery, "uQ"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropQuery, "uK"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropQuery, "uWeightsGrad"), 2);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropQuery, "uGrad"), 3);
	this.gl.useProgram(this.Programs.AttentionBackpropKey);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropKey, "uQ"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropKey, "uK"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropKey, "uWeightsGrad"), 2);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.AttentionBackpropKey, "uGrad"), 3);
	
	this.gl.useProgram(this.Programs.Tokenize);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Tokenize, "uInput"), 0);
	this.TokenizeSize = this.gl.getUniformLocation(this.Programs.Tokenize, "uSize");

	this.gl.useProgram(this.Programs.TokenizeBackprop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.TokenizeBackprop, "uGrad"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.TokenizeBackprop, "uInput"), 1);
	this.TokenizeBackpropSize = this.gl.getUniformLocation(this.Programs.TokenizeBackprop, "uSize");
	this.TokenizeBackpropWidth = this.gl.getUniformLocation(this.Programs.TokenizeBackprop, "uWidth");
	this.TokenizeBackpropActivationFunction = this.gl.getUniformLocation(this.Programs.TokenizeBackprop, "uActivationFunction");
	
	this.gl.useProgram(this.Programs.Display);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Display, "uInput"), 0);

	this.gl.useProgram(this.Programs.LayerMean);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LayerMean, "uInput"), 0);
	this.gl.useProgram(this.Programs.LayerMeanSubtract);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LayerMeanSubtract, "uInput"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LayerMeanSubtract, "uMean"), 1);
	this.gl.useProgram(this.Programs.LayerVariance);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LayerVariance, "uInput"), 0);
	this.gl.useProgram(this.Programs.LayerVarianceDivide);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LayerVarianceDivide, "uInput"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LayerVarianceDivide, "uVariance"), 1);

	this.gl.useProgram(this.Programs.LayerNormBackprop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LayerNormBackprop, "uGrad"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LayerNormBackprop, "uInput"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.LayerNormBackprop, "uVariance"), 2);
	this.LayerNormBackpropActivationFunction = this.gl.getUniformLocation(this.Programs.LayerNormBackprop, "uActivationFunction");

	this.gl.useProgram(this.Programs.IndexStamp);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.IndexStamp, "uInput"), 0);
	this.IndexStampVertical = this.gl.getUniformLocation(this.Programs.IndexStamp, "uVertical");

	this.gl.useProgram(this.Programs.Repeat);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.Repeat, "uInput"), 0);

	this.gl.useProgram(this.Programs.RepeatBackprop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.RepeatBackprop, "uInput"), 0);
	
	this.gl.useProgram(this.Programs.FourierRU);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.FourierRU, "uInput"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.FourierRU, "uFreqPhases"), 1);
	this.FourierTime = this.gl.getUniformLocation(this.Programs.FourierRU, "Time");
	this.FourierFactor = this.gl.getUniformLocation(this.Programs.FourierRU, "Factor");
	
	this.gl.useProgram(this.Programs.FourierRUBackprop);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.FourierRUBackprop, "uGrad"), 0);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.FourierRUBackprop, "uInput"), 1);
	this.gl.uniform1i(this.gl.getUniformLocation(this.Programs.FourierRUBackprop, "uFreqPhases"), 2);
	this.FourierBackpropTime = this.gl.getUniformLocation(this.Programs.FourierRUBackprop, "Time");
	this.FourierBackpropActivationFunction = this.gl.getUniformLocation(this.Programs.FourierRUBackprop, "uActivationFunction");
	
    this.ConvFrameBuffer = this.gl.createFramebuffer();
	this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.ConvFrameBuffer);
    this.gl.drawBuffers([this.gl.COLOR_ATTACHMENT0,this.gl.COLOR_ATTACHMENT1,this.gl.COLOR_ATTACHMENT2]);
    this.FrameBuffer = this.gl.createFramebuffer();
	this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.FrameBuffer);
	this.RecurrentUnit = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		this.concatLayer = new self.ConcatLayer({});
		this.layer = new self.DenseLayer({inputSize:[options.inputSize[0]+options.outputs,options.inputSize[1],1],outputs:options.outputs,ActivationFunction:"tanh"});
		this.Output = this.layer.Output;
		this.outputSize = [options.outputs,options.inputSize[1],1];
		this.call = function(Input) {
			this.layer.call(this.concatLayer.call([Input,this.Output]));
			return this.Output;
		}
		this.backprop = function(grad,prevActFunction) {
			return this.concatLayer.backprop(this.layer.backprop(grad,prevActFunction))[0];
		}
		this.finnishBatch = function(lr) {
			this.layer.finnishBatch(lr);
		}
	}
	this.FourierRecurrentUnit = function(options) {
		this.options = options;
		this.Falloff = options.Falloff || 1;
		this.ActivationFunction = 0;
		this.outputSize = [options.inputSize[0]*2,options.inputSize[1],1];
		//this.StateLayer = new self.DenseLayer({inputSize:[options.outputs,options.inputSize[1],1],outputs:options.stateOutputs,ActivationFunction:"linear"});
		this.HstateLayer = new self.DenseLayer({inputSize:[options.inputSize[0]+options.stateOutputs,options.inputSize[1],1],outputs:options.outputs,ActivationFunction:options.ActivationFunction});
		this.OutputLayer = new self.DenseLayer({inputSize:[options.stateOutputs,options.inputSize[1],1],outputs:options.outputs,ActivationFunction:"linear"});
		this.Output = this.OutputLayer.Output;
		this.concatLayer = new self.ConcatLayer({});
		this.FGrad = new self.Value([options.stateOutputs,options.inputSize[1],1]);
		this.HiddenState = new self.Value([options.stateOutputs,options.inputSize[1],1]);
		this.Time = 0;
		this.Factor = 0;
		//this.State = new self.State([this.Output,this.StateLayer.Output,this.HstateLayer.Output]);
		this.State = new self.State([this.Output,this.HstateLayer.Output]);
		// this.FreqPhase = new self.Value([options.stateOutputs,1,2],new Float32Array(options.stateOutputs*2).map(function(dc,i){return i&1 == 0 ? Math.random() : 2*Math.PI*Math.random()}));
		// this.FreqPhase = new self.Value([options.stateOutputs,1,2],new Float32Array(options.stateOutputs*2).map(function(dc,i){return i&1 == 0 ? 1/((i>>1)+1) : 2*Math.PI*Math.random()}));
		this.FreqPhase = new self.Value([options.stateOutputs,1,2],new Float32Array(options.stateOutputs*2).map(function(dc,i){return i&1 == 0 ? 1/(1<<(i>>1)) : 2*Math.PI*Math.random()}));
		// this.FreqPhase = new self.Value([options.stateOutputs,1,2],new Float32Array(options.stateOutputs*2).map(function(dc,i){return i&1 == 0 ? 1 : 0}));
		//this.ParameterCount = this.StateLayer.ParameterCount+this.HstateLayer.ParameterCount+this.OutputLayer.ParameterCount;
		//this.Parameters = new self.Parameters([this.StateLayer.Parameters,this.HstateLayer.Parameters,this.OutputLayer.Parameters],this);
		this.ParameterCount = this.HstateLayer.ParameterCount+this.OutputLayer.ParameterCount;
		this.Parameters = new self.Parameters([this.FreqPhase,this.HstateLayer.Parameters,this.OutputLayer.Parameters],this);
		this.Input = null;
		this.Interval = Math.PI;
		this.call = function(Input) {
			this.Input = Input;
			//var g = this.StateLayer.call(this.HiddenState);
			//var h = this.HstateLayer.call(this.concatLayer.call([g,Input]));
			
			var h = this.HstateLayer.call(this.concatLayer.call([this.HiddenState,Input]));
			
			this.HiddenState.setSize([h.size[0],h.size[1],1]);
			self.gl.enable(self.gl.BLEND);
            //self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.blendFunc(self.gl.SRC_ALPHA, self.gl.ONE_MINUS_SRC_ALPHA);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.HiddenState.Texture, 0);
			self.gl.useProgram(self.Programs.FourierRU);
			this.Time++;
			this.Factor *= this.Falloff;
			this.Factor++;
			self.gl.uniform1f(self.FourierFactor,1/this.Factor);
			self.gl.uniform1f(self.FourierTime,this.Time);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, h.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.FreqPhase.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			
			return this.OutputLayer.call(this.HiddenState);
		}
		this.backprop = function(grad,prevActFunction) {
			var g = this.OutputLayer.backprop(grad,"linear");
			//alert(g.size.join(",")+"\n"+grad.size.join(","));
			
			this.FGrad.setSize([g.size[0],g.size[1],1]);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.FGrad.Texture, 0);
			self.gl.useProgram(self.Programs.FourierRUBackprop);
			if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
                self.gl.uniform1i(self.FourierBackpropActivationFunction,0);
            } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
                self.gl.uniform1i(self.FourierBackpropActivationFunction,1);
            } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
                self.gl.uniform1i(self.FourierBackpropActivationFunction,2);
            } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
				self.gl.uniform1i(self.FourierBackpropActivationFunction,3);
			}
			self.gl.uniform1f(self.FourierBackpropTime,this.Time);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, g.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.HiddenState.Texture);
			self.gl.activeTexture(self.gl.TEXTURE2);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.FreqPhase.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			
			var result = this.concatLayer.backprop(this.HstateLayer.backprop(this.FGrad,prevActFunction));
			//alert(result[0].toArray(1));
			//alert(this.FreqPhase.toArray(2));
			
			return result[1];
		}
		this.reset = function() {
			this.Time = 0;
			this.Factor = 0;
			this.HiddenState.clear();
		}
		this.finnishBatch = function(lr) {
			this.HstateLayer.finnishBatch(lr);
			this.OutputLayer.finnishBatch(lr);
		}
	}
	this.RepeatLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
            this.ActivationFunction = 3;
        }
		this.outputSize = [options.inputSize[0],1,1];
		this.Output = new self.Value(this.outputSize);
		this.Grad = new self.Value(options.inputSize);
		this.State = new self.State([this.Output]);
		this.Input = null;
		this.call = function(Input,count) {
			this.Input = Input;
			this.Output.setSize([Input.size[0],count]);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.useProgram(self.Programs.Repeat);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad,prevAct) {
			this.Grad.setSize(this.Input.size);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.useProgram(self.Programs.RepeatBackprop);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function() {}
	}
	this.RepeatValueLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
            this.ActivationFunction = 3;
        }
		this.outputSize = [options.outputs,1,1];
		this.Output = new self.Value(this.outputSize);
		this.Grad = new self.Value(this.outputSize);
		this.Value = new self.Value(this.outputSize,new Float32Array(options.outputs).map(self.randn));
		this.State = new self.State([this.Output]);
		this.ParameterCount = options.outputs;
		this.Parameters = new self.Parameters([this.Value],this);
		this.Gradent = new self.Gradents([this.Grad],this);
		this.count = 0;
		this.BatchSize = 0;
		this.call = function(count) {
			this.count = count;
			this.Output.setSize([this.outputSize[0],count]);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.useProgram(self.Programs.Repeat);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Value.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad,prevAct) {
			this.BatchSize += this.count;
			self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.useProgram(self.Programs.RepeatBackprop);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
		}
		this.finnishBatch = function(lr) {
			self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Value.Texture, 0);
			self.gl.useProgram(self.Programs.AddWaB);
			self.gl.uniform1f(self.uFactor2,lr/this.BatchSize);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Grad.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			this.Grad.clear();
			this.BatchSize = 0;
		}
	}
	this.IndexStampLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
            this.ActivationFunction = 3;
        }
		//if (options.vertical) {
		//	this.outputSize = [options.inputSize[0],options.inputSize[1]+options.positionalEncodingDims,1];
		//} else {
		//	this.outputSize = [options.inputSize[0]+options.positionalEncodingDims,options.inputSize[1],1];
		//}
		this.outputSize = options.inputSize;
		this.Output = new self.Value(this.outputSize);
		this.Grad = new self.Value(options.inputSize);
		this.State = new self.State([this.Output]);
		this.Input = null;
		this.call = function(Input) {
			this.Input = Input;
			//if (this.options.vertical) {
			//	this.Output.setSize([Input.size[0],Input.size[1]+this.options.positionalEncodingDims]);
			//} else {
			//	this.Output.setSize([Input.size[0]+this.options.positionalEncodingDims,Input.size[1]]);
			//}
			this.Output.setSize([Input.size[0],Input.size[1]]);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.useProgram(self.Programs.IndexStamp);
			self.gl.uniform1i(self.IndexStampVertical,Boolean(this.options.vertical));
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad,prevAct) {
			this.Grad.setSize(this.Input.size);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.useProgram(self.Programs.Split);
			self.gl.uniform1i(self.SplitVertical,Boolean(this.options.vertical));
			self.gl.uniform1i(self.SplitWidth,0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function() {}
	}
	this.TimedIndexStampLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
            this.ActivationFunction = 3;
        }
		//if (options.vertical) {
		//	this.outputSize = [options.inputSize[0],options.inputSize[1]+options.positionalEncodingDims,1];
		//} else {
		//	this.outputSize = [options.inputSize[0]+options.positionalEncodingDims,options.inputSize[1],1];
		//}
		this.outputSize = options.inputSize;
		this.Output = new self.Value(this.outputSize);
		this.Grad = new self.Value(options.inputSize);
		this.State = new self.State([this.Output]);
		this.Input = null;
		this.Time = 0;
		this.call = function(Input) {
			this.Input = Input;
			//if (this.options.vertical) {
			//	this.Output.setSize([Input.size[0],Input.size[1]+this.options.positionalEncodingDims]);
			//} else {
			//	this.Output.setSize([Input.size[0]+this.options.positionalEncodingDims,Input.size[1]]);
			//}
			this.Output.setSize([Input.size[0],Input.size[1]]);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.useProgram(self.Programs.IndexStampTimed);
			self.gl.uniform1f(self.IndexStampTimedTime,this.Time);
			self.gl.uniform1i(self.IndexStampTimedVertical,Boolean(this.options.vertical));
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			this.Time += this.options.vertical ? Input.size[0] : Input.size[1];
			return this.Output;
		}
		this.backprop = function(grad,prevAct) {
			this.Grad.setSize(this.Input.size);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.useProgram(self.Programs.Split);
			self.gl.uniform1i(self.SplitVertical,Boolean(this.options.vertical));
			self.gl.uniform1i(self.SplitWidth,0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.reset = function() {
			this.Time = 0;
		}
		this.finnishBatch = function() {}
	}
	this.NormalizeLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		this.Means = new self.Value([1,1,1]);
		this.Subtracted = new self.Value([1,1,1]);
		this.Variances = new self.Value([1,1,1]);
		this.Output = new self.Value([1,1,1]);
		this.Grad = new self.Value([1,1,1]);
		this.outputSize = options.inputSize;
		this.State = new self.State([this.Output]);
		this.Input = null;
		this.call = function(Input) {
			this.Input = Input;
			//this.Means.setSize([Input.size[0],1]);
			this.Means.setSize([1,Input.size[1]]);
			this.Subtracted.setSize(Input.size);
			this.Variances.setSize([1,Input.size[1]]);
			this.Output.setSize(Input.size);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.useProgram(self.Programs.LayerMean);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Means.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.useProgram(self.Programs.LayerMeanSubtract);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Subtracted.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Means.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.useProgram(self.Programs.LayerVariance);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Variances.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Subtracted.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.useProgram(self.Programs.LayerVarianceDivide);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Subtracted.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Variances.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad,prevActFunction) {
			// return grad;

			this.Grad.setSize(this.Input.size);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.useProgram(self.Programs.LayerNormBackprop);
			if (prevActFunction == "linear" || prevActFunction === 0) {
                self.gl.uniform1i(self.LayerNormBackpropActivationFunction,0);
            } else if (prevActFunction == "relu" || prevActFunction === 1) {
                self.gl.uniform1i(self.LayerNormBackpropActivationFunction,1);
            } else if (prevActFunction == "tanh" || prevActFunction === 2) {
                self.gl.uniform1i(self.LayerNormBackpropActivationFunction,2);
            } else if (prevActFunction == "sigmoid" || prevActFunction === 3) {
				self.gl.uniform1i(self.LayerNormBackpropActivationFunction,3);
			}
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Input.Texture);
			self.gl.activeTexture(self.gl.TEXTURE2);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Variances.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;

			// this.Grad.setSize(this.Input.size);
			// self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			// self.gl.useProgram(self.Programs.LayerVarianceDivide);
			// self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			// self.gl.activeTexture(self.gl.TEXTURE0);
			// self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			// self.gl.activeTexture(self.gl.TEXTURE1);
			// self.gl.bindTexture(self.gl.TEXTURE_2D, this.Variances.Texture);
			// self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			// return this.Grad;

			// this.Grad.setSize(this.Input.size);
			// self.gl.useProgram(self.Programs.LayerVariance);
			// self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Variances.Texture, 0);
			// self.gl.activeTexture(self.gl.TEXTURE0);
			// self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			// self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			// self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			// self.gl.useProgram(self.Programs.LayerVarianceDivide);
			// self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			// self.gl.activeTexture(self.gl.TEXTURE0);
			// self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			// self.gl.activeTexture(self.gl.TEXTURE1);
			// self.gl.bindTexture(self.gl.TEXTURE_2D, this.Variances.Texture);
			// self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			// return this.Grad;
		}
		this.finnishBatch = function() {}
	}
	this.TokenizeLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
            this.ActivationFunction = 3;
        }
		this.outputSize = [options.level*options.level*3,Math.floor(options.inputSize[0]/options.level)*Math.floor(options.inputSize[1]/options.level),1];
		this.Output = new self.Value(this.outputSize);
		this.Grad = new self.Value(options.inputSize);
		this.State = new self.State([this.Output]);
		this.Input = null;
		this.call = function(Input) {
			this.Input = Input;
			this.Output.setSize([this.options.level*this.options.level*3,Math.floor(Input.size[0]/options.level)*Math.floor(Input.size[1]/options.level),1]);
			self.gl.useProgram(self.Programs.Tokenize);
			self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.uniform1i(self.TokenizeSize,this.options.level);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad,prevAct) {
			this.Grad.setSize(this.Input.size);
			self.gl.useProgram(self.Programs.TokenizeBackprop);
			self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Input.Texture);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			if (prevAct == "linear" || prevAct === 0) {
                self.gl.uniform1i(self.TokenizeBackpropActivationFunction,0);
            } else if (prevAct == "relu" || prevAct === 1) {
                self.gl.uniform1i(self.TokenizeBackpropActivationFunction,1);
            } else if (prevAct == "tanh" || prevAct === 2) {
                self.gl.uniform1i(self.TokenizeBackpropActivationFunction,2);
            } else if (prevAct == "sigmoid" || prevAct === 3) {
				self.gl.uniform1i(self.TokenizeBackpropActivationFunction,3);
			}
			self.gl.uniform1i(self.TokenizeBackpropSize,this.options.level);
			self.gl.uniform1i(self.TokenizeBackpropWidth,this.Input.size[0]);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function(lr) {}
	}
    this.AttentionLayer = function(options) {
		this.options = options;
		this.outputSize = [options.valueDims,options.inputSize[1]];
		this.Output = new self.Value([1,1,1]);
		this.DotExp = new self.Value([1,1,1]);
		this.Sum = new self.Value([1,1,1]);
		this.Weights = new self.Value([1,1,1]);
		this.WeightsGrad = new self.Value([1,1,1]);
		this.WeightsOpGrad = new self.Value([1,1,1]);
		this.TrueWeightsGrad = new self.Value([1,1,1]);
		this.ValueGrad = new self.Value([1,1,1]);
		this.QueryGrad = new self.Value([1,1,1]);
		this.KeyGrad = new self.Value([1,1,1]);
		this.lastInput = [null,null,null];
		this.State = new self.State([this.Output]);
		this.call = function(Qtex,Ktex,Vtex) {
            this.Output.setSize([Vtex.size[0],Qtex.size[1],1]);
            this.DotExp.setSize([Vtex.size[1],Qtex.size[1],1]);
            this.WeightsGrad.setSize([Vtex.size[1],Qtex.size[1],1]);
            this.TrueWeightsGrad.setSize([Vtex.size[1],Qtex.size[1],1]);
            this.Weights.setSize([Vtex.size[1],Qtex.size[1],1]);
			this.Sum.setSize([1,Qtex.size[1],1]);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.DotExp.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Qtex.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Ktex.Texture);
			self.gl.useProgram(self.Programs.AttentionDotExp);
			self.gl.uniform1f(self.uMult,1/Math.sqrt(Qtex.size[0]));
			self.gl.uniform1f(self.uConstMult,this.options.m || 0);
			self.gl.uniform1i(self.uMask,this.options.mask);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.useProgram(self.Programs.AttentionSum);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Sum.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.DotExp.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.useProgram(self.Programs.AttentionDivide);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Weights.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.DotExp.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Sum.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.useProgram(self.Programs.AttentionValueDot);
			self.gl.uniform1i(self.AttentionResid,!this.options.noRisid);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Vtex.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights.Texture);
			self.gl.activeTexture(self.gl.TEXTURE2);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Qtex.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			this.lastInput = [Qtex,Ktex,Vtex];
			return this.Output;
		}
		this.backprop = function(inputGraident) {
			this.ValueGrad.setSize(this.lastInput[2].size);
            this.KeyGrad.setSize(this.lastInput[1].size);
            this.QueryGrad.setSize(this.lastInput[0].size);
			this.WeightsOpGrad.setSize([1,this.lastInput[0].size[1],1]);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.useProgram(self.Programs.AttentionBackpropValue);
			self.gl.uniform1i(self.AttentionBackpropResid,!this.options.noRisid);
			// self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.ValueGrad.Texture, 0);
			// self.gl.activeTexture(self.gl.TEXTURE0);
			// self.gl.bindTexture(self.gl.TEXTURE_2D, this.lastInput[2].Texture);
			// self.gl.activeTexture(self.gl.TEXTURE1);
			// self.gl.bindTexture(self.gl.TEXTURE_2D, inputGraident.Texture);
			// self.gl.activeTexture(self.gl.TEXTURE2);
			// self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights.Texture);
			// self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);

			self.gl.useProgram(self.Programs.AttentionBackpropWeights);
			self.gl.uniform1f(self.uMult2,1/Math.sqrt(this.lastInput[0].size[0]));
			// self.gl.uniform1f(self.uMult2,1);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.WeightsGrad.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.lastInput[2].Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, inputGraident.Texture);
			self.gl.activeTexture(self.gl.TEXTURE2);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);

			self.gl.useProgram(self.Programs.AttentionBackpropWeightsJacobianSumOp);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.WeightsOpGrad.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.WeightsGrad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			
			self.gl.useProgram(self.Programs.AttentionBackpropWeightsJacobian);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.TrueWeightsGrad.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.WeightsGrad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights.Texture);
			self.gl.activeTexture(self.gl.TEXTURE2);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.WeightsOpGrad.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			
			self.gl.useProgram(self.Programs.AttentionBackpropQuery);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.QueryGrad.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.lastInput[0].Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.lastInput[1].Texture);
			self.gl.activeTexture(self.gl.TEXTURE2);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.TrueWeightsGrad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE3);
			self.gl.bindTexture(self.gl.TEXTURE_2D, inputGraident.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.useProgram(self.Programs.AttentionBackpropKey);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.KeyGrad.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.lastInput[0].Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.lastInput[1].Texture);
			self.gl.activeTexture(self.gl.TEXTURE2);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.TrueWeightsGrad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE3);
			self.gl.bindTexture(self.gl.TEXTURE_2D, inputGraident.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return [this.QueryGrad,this.KeyGrad,this.ValueGrad];
		}
	}
	this.SimpleRecurrentAttention = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayer = new self.AttentionLayer(options);
        this.QueryLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.queryKeyDims});
        this.KeyLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.queryKeyDims});
        this.ValueLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.valueDims});
		this.concatLayer = new self.ConcatLayer({vertical:true});
		this.outputSize = this.attentionLayer.outputSize;
		this.ParameterCount = this.QueryLayer.ParameterCount+this.KeyLayer.ParameterCount+this.ValueLayer.ParameterCount;
		this.Grad = new self.Value([1,1,1]);
		this.Output = this.attentionLayer.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.QueryLayer.Parameters,this.KeyLayer.Parameters,this.ValueLayer.Parameters],this);
		this.Gradent = new self.Gradents([this.QueryLayer.Gradent,this.KeyLayer.Gradent,this.ValueLayer.Gradent],this);
		this.Input = null;
        this.call = function(Input) {
			this.Input = Input;
			var c = this.concatLayer.call([Input,this.Output]);
            return this.attentionLayer.call(this.QueryLayer.call(Input),this.KeyLayer.call(c),this.ValueLayer.call(c));
        }
        this.backprop = function(grad,prevAct) {
			var grads = this.attentionLayer.backprop(grad);
			grads[0] = this.QueryLayer.backprop(grads[0],prevAct);
			grads[1] = this.KeyLayer.backprop(grads[1],prevAct);
			grads[2] = this.ValueLayer.backprop(grads[2],prevAct);
			this.Grad.size = this.Input.size;
			this.Grad.clear();
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.useProgram(self.Programs.Display);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[0].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[1].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[2].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
            return this.Grad;
        }
        this.finnishBatch = function(lr) {
            this.QueryLayer.finnishBatch(lr);
            this.KeyLayer.finnishBatch(lr);
            this.ValueLayer.finnishBatch(lr);
        }
	}
    this.SelfAttentionLayer = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayer = new self.AttentionLayer(options);
        this.QueryLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.queryKeyDims});
        this.KeyLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.queryKeyDims});
        this.ValueLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.valueDims});
		this.outputSize = this.attentionLayer.outputSize;
		this.ParameterCount = this.QueryLayer.ParameterCount+this.KeyLayer.ParameterCount+this.ValueLayer.ParameterCount;
		this.Grad = new self.Value([1,1,1]);
		this.Output = this.attentionLayer.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.QueryLayer.Parameters,this.KeyLayer.Parameters,this.ValueLayer.Parameters],this);
		this.Gradent = new self.Gradents([this.QueryLayer.Gradent,this.KeyLayer.Gradent,this.ValueLayer.Gradent],this);
		this.Input = null;
        this.call = function(Input) {
			this.Input = Input;
            return this.attentionLayer.call(this.QueryLayer.call(Input),this.KeyLayer.call(Input),this.ValueLayer.call(Input));
        }
        this.backprop = function(grad,prevAct) {
			var grads = this.attentionLayer.backprop(grad);
			grads[0] = this.QueryLayer.backprop(grads[0],prevAct);
			grads[1] = this.KeyLayer.backprop(grads[1],prevAct);
			grads[2] = this.ValueLayer.backprop(grads[2],prevAct);
			this.Grad.size = this.Input.size;
			this.Grad.clear();
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.useProgram(self.Programs.Display);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[0].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[1].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[2].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
            return this.Grad;
        }
        this.finnishBatch = function(lr) {
            this.QueryLayer.finnishBatch(lr);
            this.KeyLayer.finnishBatch(lr);
            this.ValueLayer.finnishBatch(lr);
        }
	}
	this.MemoryOptimizedSelfAttentionLayer = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayer = new self.AttentionLayer(options);
        this.QueryLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.queryKeyDims});
        this.KeyLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.queryKeyDims});
        this.ValueLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.valueDims});
		this.outputSize = this.attentionLayer.outputSize;
		this.ParameterCount = this.QueryLayer.ParameterCount+this.KeyLayer.ParameterCount+this.ValueLayer.ParameterCount;
		this.Grad = new self.Value([1,1,1]);
		this.reseted = true;
		this.concatLayer = new self.ConcatLayer({vertical:true});
		this.KeyMemory = new self.Value([options.queryKeyDims,1,1]);
		this.ValueMemory = new self.Value([options.valueDims,1,1]);
		this.Output = this.attentionLayer.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.QueryLayer.Parameters,this.KeyLayer.Parameters,this.ValueLayer.Parameters],this);
		this.Gradent = new self.Gradents([this.QueryLayer.Gradent,this.KeyLayer.Gradent,this.ValueLayer.Gradent],this);
		this.Input = null;
        this.call = function(Input) {
			this.Input = Input;
			var K = this.KeyLayer.call(Input);
			var V = this.ValueLayer.call(Input);
			return this.attentionLayer.call(this.QueryLayer.call(Input),K,V);
			if (this.reseted) {
				this.KeyMemory.set(K);
				this.ValueMemory.set(V);
				this.reseted = false;
				return this.attentionLayer.call(this.QueryLayer.call(Input),K,V);
			} else {
				this.KeyMemory.set(this.concatLayer.call([K,this.KeyMemory]));
				this.ValueMemory.set(this.concatLayer.call([V,this.ValueMemory]));
				this.reseted = false;
				return this.attentionLayer.call(this.QueryLayer.call(Input),this.KeyMemory,this.ValueMemory);
			}
			
        }
        this.backprop = function(grad,prevAct) {
			var grads = this.attentionLayer.backprop(grad);
			grads[0] = this.QueryLayer.backprop(grads[0],prevAct);
			grads[1] = this.KeyLayer.backprop(grads[1],prevAct);
			grads[2] = this.ValueLayer.backprop(grads[2],prevAct);
			this.Grad.size = this.Input.size;
			this.Grad.clear();
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.useProgram(self.Programs.Display);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[0].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[1].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[2].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
            return this.Grad;
        }
        this.finnishBatch = function(lr) {
            this.QueryLayer.finnishBatch(lr);
            this.KeyLayer.finnishBatch(lr);
            this.ValueLayer.finnishBatch(lr);
        }
		this.reset = function() {
			this.reseted = true;
			this.KeyMemory.setSize([1,1,1]);
			this.ValueMemory.setSize([1,1,1]);
		}
	}
	this.MemoryOptimizedMultiHeadedSelfAttentionLayer = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayers = [];
		this.outputSize = [options.heads*options.valueDims,options.inputSize[1]];
		this.ParameterCount = 0;
		var p = [];
		var g = [];
		for (var i=0; i<options.heads; i++) {
			this.attentionLayers.push(new self.MemoryOptimizedSelfAttentionLayer(options));
			this.ParameterCount += this.attentionLayers[i].ParameterCount;
			p.push(this.attentionLayers[i].Parameters);
			g.push(this.attentionLayers[i].Gradent);
		}
		this.concatLayer = new self.ConcatLayer({});
		this.Output = this.concatLayer.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters(p,this);
		this.Gradent = new self.Gradents(g,this);
		this.Grad = new self.Value([1,1,1]);
		this.Input = null;
        this.call = function(Input) {
			this.Input = Input;
			var results = [];
			for (var i=0; i<this.attentionLayers.length; i++) {
				results.push(this.attentionLayers[i].call(Input));
			}
			return this.concatLayer.call(results);
            // return this.attentionLayer.call(this.QueryLayer.call(Input),this.KeyLayer.call(Input),this.ValueLayer.call(Input));
        }
        this.backprop = function(grad,prevAct) {
			this.Grad.size = this.Input.size;
			this.Grad.clear();
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			var grads = this.concatLayer.backprop(grad);
			for (var i=0; i<this.attentionLayers.length; i++) {
				var g = this.attentionLayers[i].backprop(grads[i],prevAct);
				self.gl.useProgram(self.Programs.Display);
				self.gl.enable(self.gl.BLEND);
				self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
				self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
				self.gl.activeTexture(self.gl.TEXTURE0);
				self.gl.bindTexture(self.gl.TEXTURE_2D, g.Texture);
				self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
				self.gl.disable(self.gl.BLEND);
			}
            return this.Grad;
        }
        this.finnishBatch = function(lr) {
			for (var i=0; i<this.attentionLayers.length; i++) {
				this.attentionLayers[i].finnishBatch(lr);
			}
        }
		this.reset = function() {
			for (var i=0; i<this.attentionLayers.length; i++) {
				this.attentionLayers[i].reset();
			}
		}
	}
	this.FullMemoryOptimizedMultiHeadedSelfAttentionLayer = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayer = new self.MemoryOptimizedMultiHeadedSelfAttentionLayer(options);
		this.Dense0 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'relu',outputs:this.attentionLayer.outputSize[0]});
		this.Dense1 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'relu',outputs:this.attentionLayer.outputSize[0]});
		this.Dense2 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'linear',outputs:options.inputSize[0]});
		this.outputSize = this.Dense2.outputSize;
		this.normLayer = new self.NormalizeLayer({});
		this.concatLayer = new self.ConcatLayer({vertical:true});
		this.ParameterCount = this.attentionLayer.ParameterCount+this.Dense0.ParameterCount+this.Dense1.ParameterCount+this.Dense2.ParameterCount;
		this.Output = this.Dense2.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.attentionLayer.Parameters,this.Dense0.Parameters,this.Dense1.Parameters,this.Dense2.Parameters],this);
		this.Gradent = new self.Gradents([this.Dense0.Gradent,this.Dense1.Gradent,this.Dense2.Gradent],this);
		this.Input = null;
        this.call = function(Input) {
			this.Input = Input;
			var r = this.Dense2.call(this.Dense1.call(this.Dense0.call(this.attentionLayer.call(Input))));
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, r.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			var result = this.normLayer.call(r);
            return result;
        }
        this.backprop = function(grad,prevAct) {
			var g0 = this.normLayer.backprop(grad,"linear");
			var g1 = this.attentionLayer.backprop(this.Dense0.backprop(this.Dense1.backprop(this.Dense2.backprop(g0,"relu"),"relu"),"linear"),prevAct);
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, g1.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, g0.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			return g1;
        }
		this.reset = function() {
			this.attentionLayer.reset();
		}
        this.finnishBatch = function(lr) {
            this.attentionLayer.finnishBatch(lr);
			this.Dense0.finnishBatch(lr);
			this.Dense1.finnishBatch(lr);
			this.Dense2.finnishBatch(lr);
        }
	}
	this.AttentionLayer2 = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayer = new self.AttentionLayer(options);
        this.QueryLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.queryKeyDims});
        this.KeyLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.queryKeyDims});
        this.ValueLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.valueDims});
		this.outputSize = this.attentionLayer.outputSize;
		this.ParameterCount = this.QueryLayer.ParameterCount+this.KeyLayer.ParameterCount+this.ValueLayer.ParameterCount;
		this.Grad = new self.Value([1,1,1]);
		this.Output = this.attentionLayer.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.QueryLayer.Parameters,this.KeyLayer.Parameters,this.ValueLayer.Parameters],this);
		this.Gradent = new self.Gradents([this.QueryLayer.Gradent,this.KeyLayer.Gradent,this.ValueLayer.Gradent],this);
		this.Input0 = null;
		this.Input1 = null;
        this.call = function(Qwery,KeyValue) {
			this.Input0 = Qwery;
			this.Input1 = KeyValue;
            return this.attentionLayer.call(this.QueryLayer.call(Qwery),this.KeyLayer.call(KeyValue),this.ValueLayer.call(KeyValue));
        }
        this.backprop = function(grad,prevAct) {
			var grads = this.attentionLayer.backprop(grad);
			grads[0] = this.QueryLayer.backprop(grads[0],prevAct);
			grads[1] = this.KeyLayer.backprop(grads[1],prevAct);
			grads[2] = this.ValueLayer.backprop(grads[2],prevAct);
			this.Grad.size = this.Input0.size;
			this.Grad.clear();
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.useProgram(self.Programs.Display);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[1].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[2].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
            return [grads[0],this.Grad];
        }
        this.finnishBatch = function(lr) {
            this.QueryLayer.finnishBatch(lr);
            this.KeyLayer.finnishBatch(lr);
            this.ValueLayer.finnishBatch(lr);
        }
	}
	this.MultiHeadedAttentionLayer = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayers = [];
		this.outputSize = [options.heads*options.valueDims,options.inputSize[1],1];
		this.ParameterCount = 0;
		var p = [];
		var g = [];
		for (var i=0; i<options.heads; i++) {
			this.attentionLayers.push(new self.AttentionLayer2(options));
			this.ParameterCount += this.attentionLayers[i].ParameterCount;
			p.push(this.attentionLayers[i].Parameters);
			g.push(this.attentionLayers[i].Gradent);
		}
		this.concatLayer = new self.ConcatLayer({});
		this.Output = this.concatLayer.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters(p,this);
		this.Gradent = new self.Gradents(g,this);
		this.Grad0 = new self.Value([1,1,1]);
		this.Grad1 = new self.Value([1,1,1]);
		this.Input0 = null;
		this.Input1 = null;
        this.call = function(Qwery,KeyValue) {
			this.Input0 = Qwery;
			this.Input1 = KeyValue;
			var results = [];
			for (var i=0; i<this.attentionLayers.length; i++) {
				results.push(this.attentionLayers[i].call(Qwery,KeyValue));
			}
			return this.concatLayer.call(results);
            // return this.attentionLayer.call(this.QueryLayer.call(Input),this.KeyLayer.call(Input),this.ValueLayer.call(Input));
        }
        this.backprop = function(grad,prevAct) {
			this.Grad0.size = this.Input0.size;
			this.Grad0.clear();
			this.Grad1.size = this.Input1.size;
			this.Grad1.clear();
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			var grads = this.concatLayer.backprop(grad);
			for (var i=0; i<this.attentionLayers.length; i++) {
				var g = this.attentionLayers[i].backprop(grads[i],prevAct);
				// console.log(g.toArrayRed());
				self.gl.useProgram(self.Programs.Display);

				// self.gl.useProgram(self.Programs.AddWaB);
				// self.gl.uniform1f(self.uFactor2,1.0/(this.options.heads*this.Input.size[0]*3));

				self.gl.enable(self.gl.BLEND);
				self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
				self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad0.Texture, 0);
				self.gl.activeTexture(self.gl.TEXTURE0);
				self.gl.bindTexture(self.gl.TEXTURE_2D, g[0].Texture);
				self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);

				self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad1.Texture, 0);
				self.gl.activeTexture(self.gl.TEXTURE0);
				self.gl.bindTexture(self.gl.TEXTURE_2D, g[1].Texture);
				self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
				self.gl.disable(self.gl.BLEND);
			}
            return [this.Grad0,this.Grad1];
        }
        this.finnishBatch = function(lr) {
			for (var i=0; i<this.attentionLayers.length; i++) {
				this.attentionLayers[i].finnishBatch(lr);
			}
        }
	}
	this.ResidNormReluLayers = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		this.layers = [];
		this.ParameterCount = 0;
		this.normLayer = new self.NormalizeLayer({});
		for (var i=0; i<options.layers; i++) {
			var layer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'relu',outputs:options.inputSize[0]});
			this.layers.push(layer);
			this.ParameterCount += layer.ParameterCount;
		}
		var layer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.inputSize[0]});
		this.layers.push(layer);
		this.Output = this.normLayer.Output;
		this.ParameterCount += layer.ParameterCount;
		this.State = new self.Parameters(this.layers.map(function(v){return v.State}));
		this.Parameters = new self.Parameters(this.layers.map(function(v){return v.Parameters}),this);
		this.call = function(Input) {
			var result = Input;
			for (var i=0; i<this.layers.length; i++) {
				result = this.layers[i].call(result);
			}
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, result.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			return this.normLayer.call(result);
		}
		this.backprop = function(grad,prevAct) {
			grad = this.normLayer.backprop(grad,"linear");
			var g = grad;
			for (var i=this.layers.length-1; i>=0; i--) {
				g = this.layers[i].backprop(g,i === 0 ? prevAct : "linear");
			}
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, g.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			return g;
		}
		this.finnishBatch = function(lr) {
			for (var i=0; i<this.layers.length; i++) {
				this.layers[i].finnishBatch(lr);
			}
		}
	}
	this.FullMultiHeadedAttentionLayer = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayer = new self.MultiHeadedAttentionLayer(options);
		this.Dense0 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'relu',outputs:this.attentionLayer.outputSize[0]});
		this.Dense1 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'relu',outputs:this.attentionLayer.outputSize[0]});
		this.Dense2 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'linear',outputs:options.inputSize[0]});
		this.outputSize = this.Dense2.outputSize;
		this.normLayer = new self.NormalizeLayer({});
		this.concatLayer = new self.ConcatLayer({vertical:true});
		this.ParameterCount = this.attentionLayer.ParameterCount+this.Dense0.ParameterCount+this.Dense1.ParameterCount+this.Dense2.ParameterCount;
		this.Output = this.attentionLayer.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.attentionLayer.Parameters,this.Dense0.Parameters,this.Dense1.Parameters,this.Dense2.Parameters],this);
		this.Gradent = new self.Gradents([this.Dense0.Gradent,this.Dense1.Gradent,this.Dense2.Gradent],this);
        this.call = function(Input0,Input1) {
			var r = this.Dense2.call(this.Dense1.call(this.Dense0.call(this.attentionLayer.call(Input0,Input1))));
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, r.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input0.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			var result = this.normLayer.call(r);
            return result;
        }
        this.backprop = function(grad,prevAct) {
			var g0 = this.normLayer.backprop(grad,"linear");
			var g1 = this.attentionLayer.backprop(this.Dense0.backprop(this.Dense1.backprop(this.Dense2.backprop(g0,"relu"),"relu"),"linear"),prevAct);
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, g1[0].Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, g0.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			return g1;
        }
        this.finnishBatch = function(lr) {
            this.attentionLayer.finnishBatch(lr);
			this.Dense0.finnishBatch(lr);
			this.Dense1.finnishBatch(lr);
			this.Dense2.finnishBatch(lr);
        }
	}
	this.MultiHeadedRecurrentAttention = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayer = new self.MultiHeadedAttentionLayer(options);
		this.Dense0 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'relu',outputs:this.attentionLayer.outputSize[0]});
		this.Dense1 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'relu',outputs:this.attentionLayer.outputSize[0]});
		this.Dense2 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'linear',outputs:options.inputSize[0]});
		this.outputSize = this.Dense2.outputSize;
		this.normLayer = new self.NormalizeLayer({});
		this.concatLayer = new self.ConcatLayer({vertical:true});
		this.ParameterCount = this.attentionLayer.ParameterCount+this.Dense0.ParameterCount+this.Dense1.ParameterCount+this.Dense2.ParameterCount;
		this.Output = this.attentionLayer.Output;
		this.StateValue = new self.Value(this.outputSize);
		this.StateValueTmp = new self.Value(this.outputSize);
		this.StateValueDropoutOffsets = new self.Value([1,1,1]);
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.attentionLayer.Parameters,this.Dense0.Parameters,this.Dense1.Parameters,this.Dense2.Parameters],this);
		this.Gradent = new self.Gradents([this.Dense0.Gradent,this.Dense1.Gradent,this.Dense2.Gradent],this);
		this.Input = null;
        this.call = function(Input) {
			this.Input = Input;
			var r = this.Dense2.call(this.Dense1.call(this.Dense0.call(this.attentionLayer.call(Input,this.StateValue))));
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, r.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			var result = this.normLayer.call(r);
			
			// EleDropout

			var red = Math.floor(this.StateValue.size[1]*this.options.recurrency);
			var hei = this.StateValue.size[1]-red;
			this.StateValueTmp.setSize([this.StateValue.size[0],hei,1]);
			self.gl.useProgram(self.Programs.EleDropout);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.StateValueTmp.Texture, 0);
			self.gl.uniformMatrix4fv(self.EleDropoutOffsetRand,false,new Float32Array(16).map(self.randn));
			self.gl.uniform1i(self.EleDropoutOffsetCount,this.StateValue.size[1]-hei);
			self.gl.uniform1f(self.EleDropoutOffsetHeight,hei);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.StateValue.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);

			// console.log(this.StateValueTmp.size[1],this.StateValue.size[1]);

			this.StateValue.set(this.concatLayer.call([this.StateValueTmp,result]));
            return result;
        }
        this.backprop = function(grad,prevAct) {
			var g0 = this.normLayer.backprop(grad,"linear");
			var g1 = this.attentionLayer.backprop(this.Dense0.backprop(this.Dense1.backprop(this.Dense2.backprop(g0,"relu"),"relu"),"linear"),prevAct)[0];
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, g1.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, g0.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			return g1;
        }
		this.reset = function() {
			this.StateValue.setSize([this.StateValue.size[0],1,1]);
			this.StateValue.clear();
		}
        this.finnishBatch = function(lr) {
            this.attentionLayer.finnishBatch(lr);
			this.Dense0.finnishBatch(lr);
			this.Dense1.finnishBatch(lr);
			this.Dense2.finnishBatch(lr);
        }
	}
	this.MultiHeadedSelfAttentionLayer = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayers = [];
		this.outputSize = [options.heads*options.valueDims,options.inputSize[1]];
		this.ParameterCount = 0;
		var p = [];
		var g = [];
		for (var i=0; i<options.heads; i++) {
			this.attentionLayers.push(new self.SelfAttentionLayer(options));
			this.ParameterCount += this.attentionLayers[i].ParameterCount;
			p.push(this.attentionLayers[i].Parameters);
			g.push(this.attentionLayers[i].Gradent);
		}
		this.concatLayer = new self.ConcatLayer({});
		this.Output = this.concatLayer.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters(p,this);
		this.Gradent = new self.Gradents(g,this);
		this.Grad = new self.Value([1,1,1]);
		this.Input = null;
        this.call = function(Input) {
			this.Input = Input;
			var results = [];
			for (var i=0; i<this.attentionLayers.length; i++) {
				results.push(this.attentionLayers[i].call(Input));
			}
			return this.concatLayer.call(results);
            // return this.attentionLayer.call(this.QueryLayer.call(Input),this.KeyLayer.call(Input),this.ValueLayer.call(Input));
        }
        this.backprop = function(grad,prevAct) {
			this.Grad.size = this.Input.size;
			this.Grad.clear();
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			var grads = this.concatLayer.backprop(grad);
			for (var i=0; i<this.attentionLayers.length; i++) {
				var g = this.attentionLayers[i].backprop(grads[i],prevAct);
				// console.log(g.toArrayRed());
				self.gl.useProgram(self.Programs.Display);

				// self.gl.useProgram(self.Programs.AddWaB);
				// self.gl.uniform1f(self.uFactor2,1.0/(this.options.heads*this.Input.size[0]*3));

				self.gl.enable(self.gl.BLEND);
				self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
				self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
				self.gl.activeTexture(self.gl.TEXTURE0);
				self.gl.bindTexture(self.gl.TEXTURE_2D, g.Texture);
				self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
				self.gl.disable(self.gl.BLEND);
			}
			self.gl.disable(self.gl.BLEND);
            return this.Grad;
        }
        this.finnishBatch = function(lr) {
			for (var i=0; i<this.attentionLayers.length; i++) {
				this.attentionLayers[i].finnishBatch(lr);
			}
        }
	}
	this.FullMultiHeadedSelfAttentionLayer = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		this.attentionLayer = new self.MultiHeadedSelfAttentionLayer(options);
		this.Dense0 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'relu',outputs:this.attentionLayer.outputSize[0]});
		this.Dense1 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'relu',outputs:this.attentionLayer.outputSize[0]});
		this.Dense2 = new self.DenseLayer({inputSize:this.attentionLayer.outputSize,ActivationFunction:'linear',outputs:options.inputSize[0]});
		this.outputSize = this.Dense2.outputSize;
		this.normLayer = new self.NormalizeLayer({});
		this.concatLayer = new self.ConcatLayer({vertical:true});
		this.ParameterCount = this.attentionLayer.ParameterCount+this.Dense0.ParameterCount+this.Dense1.ParameterCount+this.Dense2.ParameterCount;
		this.Output = this.attentionLayer.Output;
		this.StateValue = new self.Value(this.outputSize);
		this.StateValueTmp = new self.Value(this.outputSize);
		this.StateValueDropoutOffsets = new self.Value([1,1,1]);
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.attentionLayer.Parameters,this.Dense0.Parameters,this.Dense1.Parameters,this.Dense2.Parameters],this);
		this.Gradent = new self.Gradents([this.Dense0.Gradent,this.Dense1.Gradent,this.Dense2.Gradent],this);
		this.Input = null;
        this.call = function(Input) {
			this.Input = Input;
			var r = this.Dense2.call(this.Dense1.call(this.Dense0.call(this.attentionLayer.call(Input))));
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, r.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			var result = this.normLayer.call(r);
            return result;
        }
        this.backprop = function(grad,prevAct) {
			var g0 = this.normLayer.backprop(grad,"linear");
			var g1 = this.attentionLayer.backprop(this.Dense0.backprop(this.Dense1.backprop(this.Dense2.backprop(g0,"relu"),"relu"),"linear"),prevAct);
			self.gl.useProgram(self.Programs.Display);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, g1.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, g0.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			return g1;
        }
		this.reset = function() {
			this.StateValue.setSize([this.StateValue.size[0],1,1]);
			this.StateValue.clear();
		}
        this.finnishBatch = function(lr) {
            this.attentionLayer.finnishBatch(lr);
			this.Dense0.finnishBatch(lr);
			this.Dense1.finnishBatch(lr);
			this.Dense2.finnishBatch(lr);
        }
	}
	this.FixedAttentionLayer = function(options) {
        this.options = options;
		this.ActivationFunction = 0;
		var o = {noRisid:true};
		Object.assign(o,options);
		this.attentionLayer = new self.AttentionLayer(o);
        this.Queries = new self.Value([options.queryKeyDims,options.heads,1]);
		this.QueryGrad = new self.Value([options.queryKeyDims,options.heads,1]);
		self.gl.useProgram(self.Programs.Random);
		self.gl.uniform1f(self.uM,1);
		self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
        self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Queries.Texture, 0);
        self.gl.uniformMatrix4fv(self.uRandom,false,new Float32Array(16).map(self.randn));
		self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
        this.KeyLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.queryKeyDims});
        this.ValueLayer = new self.DenseLayer({inputSize:options.inputSize,ActivationFunction:'linear',outputs:options.valueDims});
		this.outputSize = [this.attentionLayer.outputSize[0],options.heads];
		this.ParameterCount = this.KeyLayer.ParameterCount+this.ValueLayer.ParameterCount;
		this.Grad = new self.Value([1,1,1]);
		this.Output = this.attentionLayer.Output;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.Queries,this.KeyLayer.Parameters,this.ValueLayer.Parameters],this);
		this.Gradent = new self.Gradents([this.QueryGrad,this.KeyLayer.Gradent,this.ValueLayer.Gradent],this);
		this.Input = null;
		this.BatchSize = 0;
        this.call = function(KV) {
			this.Input = KV;
            return this.attentionLayer.call(this.Queries,this.KeyLayer.call(KV),this.ValueLayer.call(KV));
        }
        this.backprop = function(grad,prevAct) {
			this.BatchSize++;
			var grads = this.attentionLayer.backprop(grad);
			grads[1] = this.KeyLayer.backprop(grads[1],prevAct);
			grads[2] = this.ValueLayer.backprop(grads[2],prevAct);
			this.Grad.size = this.Input.size;
			this.Grad.clear();
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.useProgram(self.Programs.Display);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[1].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[2].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);

			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.QueryGrad.Texture, 0);
			self.gl.useProgram(self.Programs.Display);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grads[0].Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
            return this.Grad;
        }
        this.finnishBatch = function(lr) {
            this.KeyLayer.finnishBatch(lr);
            this.ValueLayer.finnishBatch(lr);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Queries.Texture, 0);
			self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.useProgram(self.Programs.AddWaB);
			self.gl.uniform1f(self.uFactor2,lr/this.BatchSize);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.QueryGrad.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			this.QueryGrad.clear();
			this.BatchSize = 0;
        }
	}
	this.TemporalShiftLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
            this.ActivationFunction = 3;
        }
		if (options.horizontal) {
			this.outputSize = [options.inputSize[0]*options.depth,options.inputSize[1],1];
		} else {
			this.outputSize = [options.inputSize[0],options.inputSize[1]*options.depth,1];
		}
		this.Grad = new self.Value(options.inputSize);
		this.Temp = new self.Value(this.outputSize);
		this.Output = new self.Value(this.outputSize);
		this.State = new self.State([this.Output]);
		this.Input = null;
		this.call = function(Input) {
			this.Input = Input;
			self.gl.useProgram(self.Programs.Shift);
			self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Temp.Texture);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            if (this.options.horizontal) {
                this.Output.setSize([Math.min(this.Output.size[0]+Input.size[0],this.options.inputSize[1]*this.options.depth),Input.size[1]]);
            } else {
                this.Output.setSize([Input.size[0],Math.min(this.Output.size[1]+Input.size[1],this.options.inputSize[1]*this.options.depth)]);
            }
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.uniform1i(self.ShiftHorizontal,this.options.horizontal);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			this.Temp.set(this.Output);
			return this.Output;
		}
		this.backprop = function(grad) {
			// return grad;

			this.Grad.setSize(this.Input.size);
			self.gl.useProgram(self.Programs.Display);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function(lr) {}
	}
	this.ConcatLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
            this.ActivationFunction = 3;
        }
		this.Grads = [];
		this.Temp = new self.Value([1,1,1]);
		this.Output = new self.Value([1,1,1]);
		this.State = new self.State([this.Output]);
        this.Inputs = [];
		this.call = function(Inputs) {
            this.Inputs = Inputs;
			this.InputSizes = [];
			if (Inputs.length <= 1) {
				this.Output.set(Inputs[0]);
				return this.Output;
			}
			if (this.options.vertical) {
				var hei = Inputs[0].size[1]+Inputs[1].size[1];
				self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
				this.Output.setSize([Math.max(Inputs[0].size[0],Inputs[1].size[0]),hei]);
				self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
				self.gl.useProgram(self.Programs.Concat);
				self.gl.uniform1i(self.ConcatVertical,true);
				self.gl.activeTexture(self.gl.TEXTURE0);
				self.gl.bindTexture(self.gl.TEXTURE_2D, Inputs[0].Texture);
				self.gl.activeTexture(self.gl.TEXTURE1);
				self.gl.bindTexture(self.gl.TEXTURE_2D, Inputs[1].Texture);
				self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
				this.InputSizes = [Inputs[0].size,Inputs[1].size];
				Inputs[0].setSize([1,1,1]);
				Inputs[1].setSize([1,1,1]);
				for (var i=2; i<Inputs.length; i++) {
					this.Temp.set(this.Output);
					hei += Inputs[i].size[1];
					this.Output.setSize([Math.max(this.Output.size[0],Inputs[i].size[0]),hei]);
					self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
					self.gl.activeTexture(self.gl.TEXTURE0);
					self.gl.bindTexture(self.gl.TEXTURE_2D, this.Temp.Texture);
					self.gl.activeTexture(self.gl.TEXTURE1);
					self.gl.bindTexture(self.gl.TEXTURE_2D, Inputs[i].Texture);
					self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
					this.InputSizes.push(Inputs[i].size);
					Inputs[i].setSize([1,1,1]);
				}
				return this.Output;
			} else {
				var wid = Inputs[0].size[0]+Inputs[1].size[0];
				self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
				this.Output.setSize([wid,Math.max(Inputs[0].size[1],Inputs[1].size[1])]);
				self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
				self.gl.useProgram(self.Programs.Concat);
				self.gl.uniform1i(self.ConcatVertical,false);
				self.gl.activeTexture(self.gl.TEXTURE0);
				self.gl.bindTexture(self.gl.TEXTURE_2D, Inputs[0].Texture);
				self.gl.activeTexture(self.gl.TEXTURE1);
				self.gl.bindTexture(self.gl.TEXTURE_2D, Inputs[1].Texture);
				self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
				this.InputSizes = [Inputs[0].size,Inputs[1].size];
				Inputs[0].setSize([1,1,1]);
				Inputs[1].setSize([1,1,1]);
				for (var i=2; i<Inputs.length; i++) {
					this.Temp.set(this.Output);
					wid += Inputs[i].size[0];
					this.Output.setSize([wid,Math.max(this.Output.size[1],Inputs[i].size[1])]);
					self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
					self.gl.activeTexture(self.gl.TEXTURE0);
					self.gl.bindTexture(self.gl.TEXTURE_2D, this.Temp.Texture);
					self.gl.activeTexture(self.gl.TEXTURE1);
					self.gl.bindTexture(self.gl.TEXTURE_2D, Inputs[i].Texture);
					self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
					this.InputSizes.push(Inputs[i].size);
					Inputs[i].setSize([1,1,1]);
				}
				return this.Output;
			}
		}
		this.backprop = function(grad) {
			if (this.options.vertical) {
				self.gl.useProgram(self.Programs.Split);
				self.gl.uniform1i(self.SplitVertical,true);
				self.gl.activeTexture(self.gl.TEXTURE0);
				self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
				self.gl.activeTexture(self.gl.TEXTURE1);
				self.gl.bindTexture(self.gl.TEXTURE_2D, null);
				self.gl.activeTexture(self.gl.TEXTURE2);
				self.gl.bindTexture(self.gl.TEXTURE_2D, null);
				self.gl.activeTexture(self.gl.TEXTURE3);
				self.gl.bindTexture(self.gl.TEXTURE_2D, null);
				var hei = 0;
				var loop = Math.max(this.Inputs.length,this.Grads.length);
				for (var i=0; i<loop; i++) {
					if (i < this.Inputs.length) {
						if (!this.Grads[i]) {
							this.Grads.push(new self.Value(this.InputSizes[i]));
						} else {
							this.Grads[i].setSize(this.InputSizes[i]);
						}
						self.gl.uniform1i(self.SplitWidth,hei);
						self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
						self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grads[i].Texture, 0);
						self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
						hei += this.InputSizes[i][1];
					} else {
						this.Grads[i].delete();
					}
				}
				return this.Grads;
			} else {
				self.gl.useProgram(self.Programs.Split);
				self.gl.uniform1i(self.SplitVertical,false);
				self.gl.activeTexture(self.gl.TEXTURE0);
				self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
				self.gl.activeTexture(self.gl.TEXTURE1);
				self.gl.bindTexture(self.gl.TEXTURE_2D, null);
				self.gl.activeTexture(self.gl.TEXTURE2);
				self.gl.bindTexture(self.gl.TEXTURE_2D, null);
				self.gl.activeTexture(self.gl.TEXTURE3);
				self.gl.bindTexture(self.gl.TEXTURE_2D, null);
				var wid = 0;
				var loop = Math.max(this.Inputs.length,this.Grads.length);
				for (var i=0; i<loop; i++) {
					if (i < this.Inputs.length) {
						if (!this.Grads[i]) {
							this.Grads.push(new self.Value(this.InputSizes[i]));
						} else {
							this.Grads[i].setSize(this.InputSizes[i]);
						}
						self.gl.uniform1i(self.SplitWidth,wid);
						self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
						self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grads[i].Texture, 0);
						self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
						wid += this.InputSizes[i][0];
					} else {
						this.Grads[i].delete();
					}
				}
				return this.Grads;
			}
		}
	}
	this.FlattenLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
            this.ActivationFunction = 3;
        }
		if (options.no3D) {
			this.outputSize = [options.inputSize[0]*options.inputSize[1],1];
		} else {
			this.outputSize = [options.inputSize[0]*options.inputSize[1]*3,1];
		}
		this.Output = new self.Value([1,1,1]);
		this.State = new self.State([this.Output]);
		this.Grad = new self.Value([1,1,3]);
        this.Input = null;
		this.call = function(Input) {
            this.Input = Input;
			if (this.options.no3D) {
				this.Output.setSize([Input.size[0]*Input.size[1],1,1]);
			} else {
				this.Output.setSize([Input.size[0]*Input.size[1]*3,1,1]);
			}
            self.gl.useProgram(self.Programs.Flatten);
			self.gl.uniform1i(self.FlattenNo3D,Boolean(this.options.no3D));
			self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            return this.Output;
		}
		this.backprop = function(grad) {
            self.gl.useProgram(self.Programs.UnFlatten);
			self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.uniform1i(self.uWidth,this.Input.size[0]);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            this.Grad.setSize(this.Input.size);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            return this.Grad;
		}
		this.finnishBatch = function(lr) {}
	}
	this.UnFlattenLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
            this.ActivationFunction = 3;
        }
		this.Output = new self.Value([options.outputSize[0],options.outputSize[1],3]);
		this.State = new self.State([this.Output]);
		this.Grad = new self.Value([1,1,1]);
        this.Input = null;
		this.call = function(Input) {
            this.Input = Input;
            self.gl.useProgram(self.Programs.UnFlatten);
			self.gl.uniform1i(self.uWidth,this.options.outputSize[0]);
			self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            return this.Output;
		}
		this.backprop = function(grad) {
            self.gl.useProgram(self.Programs.Flatten);
			self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, grad);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			this.Grad.setSize(this.Input.size);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            return this.Grad;
		}
		this.finnishBatch = function(lr) {}
	}
    this.ConvolutionalLayer = function(options) {
        this.options = options;
        this.ActivationFunction = 0;
        self.gl.useProgram(self.Programs.Random);
        if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            self.gl.uniform1f(self.uM,1/Math.sqrt((options.kernelSize*options.kernelSize*3)));
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
			// self.gl.uniform1f(self.uM,2/Math.sqrt(options.kernelSize*options.kernelSize*3));
			// self.gl.uniform1f(self.uM,Math.sqrt(2/(options.kernelSize*options.kernelSize*3)));
			self.gl.uniform1f(self.uM,Math.sqrt(2/((options.kernelSize*options.kernelSize*3)-1)));
			//self.gl.uniform1f(self.uM,Math.sqrt(1.5/(options.kernelSize*options.kernelSize*3)));
			//self.gl.uniform1f(self.uM,Math.sqrt(1/(options.kernelSize*options.kernelSize*3)));
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            self.gl.uniform1f(self.uM,Math.sqrt(1/(options.kernelSize*options.kernelSize*3)));
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
			self.gl.uniform1f(self.uM,1/Math.sqrt((options.kernelSize*options.kernelSize*3)));
            this.ActivationFunction = 3;
        }
        this.Grad = new self.Value([options.inputSize[0],options.inputSize[1],3]);
        this.outputSize = [options.inputSize[0]+1-options.kernelSize,options.inputSize[1]+1-options.kernelSize];
        this.Weights = [new self.Value([this.outputSize[0]*options.kernelSize,this.outputSize[1]*options.kernelSize,3]),new self.Value([this.outputSize[0]*options.kernelSize,this.outputSize[1]*options.kernelSize,3]),new self.Value([this.outputSize[0]*options.kernelSize,this.outputSize[1]*options.kernelSize,3])];
        self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
        self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Weights[0].Texture, 0);
        self.gl.uniformMatrix4fv(self.uRandom,false,new Float32Array(16).map(self.randn));
		self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
        self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Weights[1].Texture, 0);
        self.gl.uniformMatrix4fv(self.uRandom,false,new Float32Array(16).map(self.randn));
		self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
        self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Weights[2].Texture, 0);
        self.gl.uniformMatrix4fv(self.uRandom,false,new Float32Array(16).map(self.randn));
		self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
        this.Biases = new self.Value(this.outputSize);
        this.WeightsGrad = [new self.Value([this.outputSize[0]*options.kernelSize,this.outputSize[1]*options.kernelSize,3]),new self.Value([this.outputSize[0]*options.kernelSize,this.outputSize[1]*options.kernelSize,3]),new self.Value([this.outputSize[0]*options.kernelSize,this.outputSize[1]*options.kernelSize,3])];
        this.BiasesGrad = new self.Value(this.outputSize);
        this.Output = new self.Value(this.outputSize);
		this.ParameterCount = this.outputSize[0]*this.outputSize[1]*((options.kernelSize*options.kernelSize*3)+1)*3;
		this.State = new self.State([this.Output]);
		this.Parameters = new self.Parameters([this.Weights,this.Biases].flat(),this);
		this.Gradent = new self.Gradents([this.WeightsGrad[0],this.WeightsGrad[1],this.WeightsGrad[2],this.BiasesGrad],this);
        this.Input = null;
        this.BatchSize = 0;
        this.call = function(Input) {
            this.Input = Input;
            self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
            self.gl.activeTexture(self.gl.TEXTURE1);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights[0].Texture);
            self.gl.activeTexture(self.gl.TEXTURE2);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights[1].Texture);
            self.gl.activeTexture(self.gl.TEXTURE3);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights[2].Texture);
            self.gl.activeTexture(self.gl.TEXTURE4);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Biases.Texture);
            self.gl.useProgram(self.Programs.ConvolutionalPredict);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
            self.gl.uniform1i(self.ConvolutionalKernelSize,this.options.kernelSize);
            self.gl.uniform1i(self.ConvolutionalActivationFunction,this.ActivationFunction);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            return this.Output;
        }
        this.backprop = function(grad,prevActFunction) {
            this.BatchSize++;
            self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.SRC_ALPHA, self.gl.ONE_MINUS_SRC_ALPHA);
            self.gl.useProgram(self.Programs.BiasAdd);
			self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
            self.gl.uniform1f(self.uFactor,1/this.BatchSize);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.BiasesGrad.Texture, 0);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            self.gl.useProgram(self.Programs.ConvolutionalBackpropWaB);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.ConvFrameBuffer);
            self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
            self.gl.activeTexture(self.gl.TEXTURE1);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Input.Texture);
            self.gl.uniform1f(self.ConvolutionalBackpropFactor,1/this.BatchSize);
            self.gl.uniform1i(self.ConvolutionalBackpropWaBKernelSize,this.options.kernelSize);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.WeightsGrad[0].Texture, 0);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT1, self.gl.TEXTURE_2D, this.WeightsGrad[1].Texture, 0);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT2, self.gl.TEXTURE_2D, this.WeightsGrad[2].Texture, 0);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            self.gl.disable(self.gl.BLEND);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
            self.gl.useProgram(self.Programs.ConvolutionalBackprop);
            self.gl.uniform1i(self.ConvolutionalBackpropKernelSize,this.options.kernelSize);
            if (prevActFunction == "linear" || prevActFunction === 0) {
                self.gl.uniform1i(self.ConvolutionalBackpropActivationFunction,0);
            } else if (prevActFunction == "relu" || prevActFunction === 1) {
                self.gl.uniform1i(self.ConvolutionalBackpropActivationFunction,1);
            } else if (prevActFunction == "tanh" || prevActFunction === 2) {
                self.gl.uniform1i(self.ConvolutionalBackpropActivationFunction,2);
            } else if (prevActFunction == "sigmoid" || prevActFunction === 3) {
				self.gl.uniform1i(self.ConvolutionalBackpropActivationFunction,3);
			}
            self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
            self.gl.activeTexture(self.gl.TEXTURE1);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights[0].Texture);
            self.gl.activeTexture(self.gl.TEXTURE2);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights[1].Texture);
            self.gl.activeTexture(self.gl.TEXTURE3);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Weights[2].Texture);
            self.gl.activeTexture(self.gl.TEXTURE4);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.Input.Texture);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            return this.Grad;
        }
        this.finnishBatch = function(lr) {
            self.gl.enable(self.gl.BLEND);
            self.gl.blendFunc(self.gl.SRC_ALPHA, self.gl.ONE);
			self.gl.useProgram(self.Programs.BiasAdd);
			self.gl.uniform1f(self.uFactor,lr);
            self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.BiasesGrad.Texture);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Biases.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.WeightsGrad[0].Texture);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Weights[0].Texture, 0);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.WeightsGrad[1].Texture);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Weights[1].Texture, 0);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            self.gl.activeTexture(self.gl.TEXTURE0);
            self.gl.bindTexture(self.gl.TEXTURE_2D, this.WeightsGrad[2].Texture);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Weights[2].Texture, 0);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
            self.gl.disable(self.gl.BLEND);
            this.BatchSize = 0;
        }
    }
	this.AveragePoolingLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 'linear';
		this.outputSize = [Math.floor(options.inputSize[0]/options.level),Math.floor(options.inputSize[1]/options.level),3];
		this.Output = new self.Value(this.outputSize);
		this.State = new self.State([this.Output]);
		this.Grad = new self.Value([options.inputSize[0],options.inputSize[1],3]);
		this.Input = null;
		this.call = function(Input) {
			this.Input = Input;
			self.gl.useProgram(self.Programs.AveragePooling);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
            self.gl.uniform1i(self.AveragePoolingLevel,this.options.level);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad,prevActFunction) {
			self.gl.useProgram(self.Programs.AveragePoolingBackprop);
			if (prevActFunction == "linear" || prevActFunction === 0) {
                self.gl.uniform1i(self.AveragePoolingBackpropActivationFunction,0);
            } else if (prevActFunction == "relu" || prevActFunction === 1) {
                self.gl.uniform1i(self.AveragePoolingBackpropActivationFunction,1);
            } else if (prevActFunction == "tanh" || prevActFunction === 2) {
                self.gl.uniform1i(self.AveragePoolingBackpropActivationFunction,2);
            } else if (prevActFunction == "sigmoid" || prevActFunction === 3) {
				self.gl.uniform1i(self.AveragePoolingBackpropActivationFunction,3);
			}
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Input.Texture);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
            self.gl.uniform1i(self.AveragePoolingBackpropLevel,this.options.level);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function(lr) {}
	}
	this.UpscaleLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 'linear';
		this.outputSize = [options.inputSize[0]*options.level,options.inputSize[1]*options.level,3];
		this.Output = new self.Value(this.outputSize);
		this.State = new self.State([this.Output]);
		this.Grad = new self.Value([options.inputSize[0],options.inputSize[1],3]);
		this.Input = null;
		this.call = function(Input) {
			this.Input = Input;
			self.gl.useProgram(self.Programs.Upscale);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
            self.gl.uniform1i(self.UpscaleLevel,this.options.level);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad,prevActFunction) {
			self.gl.useProgram(self.Programs.UpscaleBackprop);
			if (prevActFunction == "linear" || prevActFunction === 0) {
                self.gl.uniform1i(self.UpscaleBackpropActivationFunction,0);
            } else if (prevActFunction == "relu" || prevActFunction === 1) {
                self.gl.uniform1i(self.UpscaleBackpropActivationFunction,1);
            } else if (prevActFunction == "tanh" || prevActFunction === 2) {
                self.gl.uniform1i(self.UpscaleBackpropActivationFunction,2);
            } else if (prevActFunction == "sigmoid" || prevActFunction === 3) {
				self.gl.uniform1i(self.UpscaleBackpropActivationFunction,3);
			}
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Input.Texture);
            self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
            self.gl.uniform1i(self.UpscaleBackpropLevel,this.options.level);
            self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function(lr) {}
	}
	this.ExpandLayer = function(options) {
		this.options = options;
		if (options.vertical) {
			this.outputSize = [options.inputSize[0],options.inputSize[1]*3,1];
		} else {
			this.outputSize = [options.inputSize[0]*3,options.inputSize[1],1];
		}
		this.Output = new self.Value(this.outputSize);
		this.State = new self.State([this.Output]);
		this.Grad = new self.Value([options.inputSize[0],options.inputSize[1],3]);
		this.Input = null;
		this.call = function(Input) {
			this.Input = Input;
			self.gl.useProgram(self.Programs.Expand);
			self.gl.uniform1i(self.ExpandVertical,this.options.vertical);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad) {
			self.gl.useProgram(self.Programs.ExpandBackprop);
			self.gl.uniform1i(self.ExpandBackpropVertical,this.options.vertical);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function(lr) {}
	}
	this.CompressLayer = function(options) {
		this.options = options;
		if (options.vertical) {
			this.outputSize = [options.inputSize[0], Math.floor(options.inputSize[1]/3),1];
		} else {
			this.outputSize = [Math.floor(options.inputSize[0]/3), options.inputSize[1],1];
		}
		this.Output = new self.Value(this.outputSize);
		this.State = new self.State([this.Output]);
		this.Grad = new self.Value([options.inputSize[0],options.inputSize[1],1]);
		this.Input = null;
		this.call = function(Input) {
			this.Input = Input;
			self.gl.useProgram(self.Programs.ExpandBackprop);
			self.gl.uniform1i(self.ExpandBackpropVertical,this.options.vertical);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad) {
			self.gl.useProgram(self.Programs.Expand);
			self.gl.uniform1i(self.ExpandVertical,this.options.vertical);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function(lr) {}
	}
	this.TransposeLayer = function(options) {
		this.options = options;
		if (options.keep3D) {
			this.outputSize = [options.inputSize[1]*3,Math.floor(options.inputSize[0]/3),3];
		} else {
			this.outputSize = [options.inputSize[1],options.inputSize[0],1];
		}
		this.Output = new self.Value(this.outputSize);
		this.State = new self.State([this.Output]);
		this.Grad = new self.Value([options.inputSize[0],options.inputSize[1],options.keep3D ? 3 : 1]);
		this.Input = null;
		this.call = function(Input) {
			this.Input = Input;
			self.gl.useProgram(self.Programs.Transpose);
			self.gl.uniform1i(self.TransposeKeep3D,this.options.keep3D);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad) {
			self.gl.useProgram(self.Programs.Transpose);
			self.gl.uniform1i(self.TransposeKeep3D,this.options.keep3D);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
            self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function(lr) {}
	}
    this.DenseLayer = function(options) {
		this.options = options;
		this.outputSize = [options.outputs,options.inputSize[1],1];
		this.WaB = new self.Value([options.outputs, Math.ceil((options.inputSize[0]+1)/4),4]);
		self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
		self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.WaB.Texture, 0);
		this.WaBgrad = new self.Value([options.outputs, Math.ceil((options.inputSize[0]+1)/4),4]);
		this.Output = new self.Value(this.outputSize);
		this.State = new self.State([this.Output]);
		this.Input = null;
		this.Grad = new self.Value([options.inputSize[0],options.inputSize[1],1]);
		this.ParameterCount = (options.inputSize[0]+1)*options.outputs;
		self.gl.useProgram(self.Programs.RandomDense);
        this.ActivationFunction = 0;
        if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            self.gl.uniform1f(self.uMDense,1/Math.sqrt(options.inputSize[0]));
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
			// self.gl.uniform1f(self.uMDense,Math.sqrt(1.5/options.inputSize[0]));
            // self.gl.uniform1f(self.uMDense,Math.sqrt(2/options.inputSize[0]));
			self.gl.uniform1f(self.uMDense,Math.sqrt(2/(options.inputSize[0])));
			// self.gl.uniform1f(self.uMDense,2/Math.sqrt(options.inputSize[0]));
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            self.gl.uniform1f(self.uMDense,Math.sqrt(2/options.inputSize[0]));
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
			self.gl.uniform1f(self.uMDense,2/Math.sqrt(options.inputSize[0]));
            this.ActivationFunction = 3;
		}
		self.gl.uniformMatrix4fv(self.uRandomDense,false,new Float32Array(16).map(self.randn));
		self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
		this.BatchSizeDiv = 0;
		this.Parameters = new self.Parameters([this.WaB],this);
		this.Gradent = new self.Gradents([this.WaBgrad],this);
		this.call = function(Input) {
			this.Input = Input;
			this.Output.setSize([this.options.outputs,Input.size[1]]);
			self.gl.useProgram(self.Programs.Dense);
			self.gl.uniform1i(self.DenseActivationFunction,this.ActivationFunction);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.WaB.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, Input.Texture);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Output.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Output;
		}
		this.backprop = function(grad,prevActFunction) {
			this.BatchSizeDiv += this.Input.size[1];
			// this.BatchSizeDiv++;
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			self.gl.useProgram(self.Programs.DenseBackpropWaB);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.WaBgrad.Texture, 0);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Input.Texture);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);

			self.gl.useProgram(self.Programs.DenseBackprop);
			if (prevActFunction == "linear" || prevActFunction === 0) {
                self.gl.uniform1i(self.DenseBackpropActivationFunction,0);
            } else if (prevActFunction == "relu" || prevActFunction === 1) {
                self.gl.uniform1i(self.DenseBackpropActivationFunction,1);
            } else if (prevActFunction == "tanh" || prevActFunction === 2) {
                self.gl.uniform1i(self.DenseBackpropActivationFunction,2);
            } else if (prevActFunction == "sigmoid" || prevActFunction === 3) {
				self.gl.uniform1i(self.DenseBackpropActivationFunction,3);
			}
			this.Grad.setSize(this.Input.size);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, grad.Texture);
			self.gl.activeTexture(self.gl.TEXTURE1);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.Input.Texture);
			self.gl.activeTexture(self.gl.TEXTURE2);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.WaB.Texture);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.Grad.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			return this.Grad;
		}
		this.finnishBatch = function(lr) {
			self.gl.useProgram(self.Programs.AddWaB);
			self.gl.bindFramebuffer(self.gl.FRAMEBUFFER, self.FrameBuffer);
			// self.gl.uniform1f(self.uFactor2,lr/(this.BatchSize*this.options.outputs*this.options.inputSize[1]));
			// self.gl.uniform1f(self.uFactor2,lr/(this.BatchSize*this.options.inputSize[0]*this.options.inputSize[1]));
			//self.gl.uniform1f(self.uFactor2,lr/(this.BatchSize*this.options.inputSize[1]));
			self.gl.uniform1f(self.uFactor2,lr/this.BatchSizeDiv);
			self.gl.activeTexture(self.gl.TEXTURE0);
			self.gl.bindTexture(self.gl.TEXTURE_2D, this.WaBgrad.Texture);
			self.gl.enable(self.gl.BLEND);
			self.gl.blendFunc(self.gl.ONE, self.gl.ONE);
			self.gl.framebufferTexture2D(self.gl.FRAMEBUFFER, self.gl.COLOR_ATTACHMENT0, self.gl.TEXTURE_2D, this.WaB.Texture, 0);
			self.gl.drawElements(self.gl.TRIANGLES, 6, self.gl.UNSIGNED_SHORT, 0);
			self.gl.disable(self.gl.BLEND);
			this.WaBgrad.clear();
			this.BatchSizeDiv = 0;
		}
	}
	this.SharedDenseImageLayer = function(options) {
		this.options = options;
		this.ActivationFunction = 0;
		if (options.ActivationFunction == "linear" || options.ActivationFunction === 0) {
            this.ActivationFunction = 0;
        } else if (options.ActivationFunction == "relu" || options.ActivationFunction === 1) {
            this.ActivationFunction = 1;
        } else if (options.ActivationFunction == "tanh" || options.ActivationFunction === 2) {
            this.ActivationFunction = 2;
        } else if (options.ActivationFunction == "sigmoid" || options.ActivationFunction === 3) {
			this.ActivationFunction = 3;
		}
		this.outputSize = [options.outputSize[0],options.outputSize[1],3];
		this.expand = new self.ExpandLayer({inputSize:options.inputSize,vertical:false});
		this.xDense = new self.DenseLayer({inputSize:[options.inputSize[0]*3,options.inputSize[1]],outputs:options.outputSize[0]*3,ActivationFunction:options.ActivationFunction});
		this.transpose = new self.TransposeLayer({inputSize:[options.outputSize[0]*3,options.inputSize[1]],keep3D:true});
		this.yDense = new self.DenseLayer({inputSize:[options.outputSize[1]*3,options.outputSize[0]],outputs:options.outputSize[1]*3,ActivationFunction:options.ActivationFunction});
		this.compress = new self.CompressLayer({inputSize:[options.outputSize[0]*3,options.outputSize[1]],vertical:false});
		this.Output = this.compress.Output;
		this.Grad = this.expand.Grad;
		this.State = new self.State([this.expand.Output,this.xDense.Output,this.transpose.Output,this.yDense.Output,this.Output]);
		this.ParameterCount = this.xDense.ParameterCount+this.yDense.ParameterCount;
		this.Parameters = new self.Parameters([this.xDense.Parameters,this.yDense.Parameters]);
		this.Gradent = new self.Gradents([this.xDense.Gradent,this.yDense.Gradent],this);
		this.call = function(Input) {
			return this.compress.call(this.yDense.call(this.transpose.call(this.xDense.call(this.expand.call(Input)))));
		}
		this.backprop = function(grad,prevActFunction) {
			return this.expand.backprop(this.xDense.backprop(this.transpose.backprop(this.yDense.backprop(this.compress.backprop(grad),this.options.ActivationFunction)),prevActFunction));
		}
		this.finnishBatch = function(lr) {
			this.xDense.finnishBatch(lr);
			this.yDense.finnishBatch(lr);
		}
	}
	this.Minus2Tau = -2*Math.PI;
	this.ComplexFFT = function(data) {
		if (data.length > 1) {
			var n2 = data.length>>1;
			var a = [];
			var b = [];
			for (var i=0; i<data.length; i++) {
				if (i&1) {
					a.push(data[i]);
				} else {
					b.push(data[i]);
				}
			}
			a = this.ComplexFFT(a);
			b = this.ComplexFFT(b);
			var result = new Array(data.length);
			for (var i=0; i<n2; i++) {
				var p = a[i];
				var angl = self.Minus2Tau*i/data.length;
				var sin = Math.sin(angl);
				var cos = Math.cos(angl);
				var q = [(cos*b[i][0])-(sin*b[i][1]),(sin*b[i][0])+(cos*b[i][1])];
				result[i] = [p[0]+q[0],p[1]+q[1]];
				result[i+n2] = [p[0]-q[0],p[1]-q[1]];
			}
			return result;
		} else {
			return data;
		}
	}
	this.realFFT = function(data) {
		if (data.length > 1) {
			var n2 = data.length>>1;
			var a = [];
			var b = [];
			for (var i=0; i<data.length; i++) {
				if (i&1) {
					a.push(data[i]);
				} else {
					b.push(data[i]);
				}
			}
			a = this.realFFT(a);
			b = this.realFFT(b);
			var result = new Array(data.length);
			for (var i=0; i<n2; i++) {
				var p = a[i];
				var angl = self.Minus2Tau*i/data.length;
				var sin = Math.sin(angl);
				var cos = Math.cos(angl);
				var q = [(cos*b[i][0])-(sin*b[i][1]),(sin*b[i][0])+(cos*b[i][1])];
				result[i] = [p[0]+q[0],p[1]+q[1]];
				result[i+n2] = [p[0]-q[0],p[1]-q[1]];
			}
			return result;
		} else {
			return [[data[0],0]];
		}
	}
	this.FrequencyFFT = function(data) {
		data = this.realFFT(data);
		var result = new Float32Array(data.length>>1);
		var m = 1/result.length;
		for (var i=0; i<result.length; i++) {
			result[i] = Math.hypot(data[i][0],data[i][1])*m;
		}
		return result;
	}
	this.FullFFT = function(data) {
		data = this.realFFT(data);
		var result = [];
		var m = 1/result.length;
		for (var i=0; i<result.length; i++) {
			result[i] = [Math.hypot(data[i][0],data[i][1])*m,Math.atan2(data[i][1],data[i][0])];
		}
		return result;
	}
	this.AllFFT = function(data) {
		data = this.realFFT(data);
		var result = new Float32Array(data.length>>1);
		var m = 1/result.length;
		for (var i=0; i<result.length; i++) {
			result[i] = Math.hypot(data[i][0],data[i][1])*m;
		}
		return {FrequencyStrengths:result,ComplexValues:data};
	}
    this.CreateLayers = function(options,inputSize) {
        var Layers = [];
        var size = inputSize || options[0].inputSize;
        var act = 0;
		var ParameterCount = 0;
		var p = [];
		var s = [];
		var g = [];
        for (var i=0; i<options.length; i++) {
            if (options[i].Convolutonal) {
                var layer = new self.ConvolutionalLayer({inputSize:size,kernelSize:options[i].kernelSize,ActivationFunction:options[i].ActivationFunction});
				p.push(layer.Parameters);
				s.push(layer.State);
				g.push(layer.Gradent);
                Layers.push(layer);
                act = options[i].ActivationFunction;
                ParameterCount += layer.ParameterCount;
                size = layer.outputSize;
            } else if (options[i].Pooling) {
                var layer = new self.AveragePoolingLayer({inputSize:size,level:options[i].level});
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].Upscale) {
                var layer = new self.UpscaleLayer({inputSize:size,level:options[i].level});
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].SharedDense) {
                var layer = new self.SharedDenseImageLayer({inputSize:size,outputSize:options[i].outputSize,ActivationFunction:options[i].ActivationFunction});
				p.push(layer.Parameters);
				g.push(layer.Gradent);
                act = options[i].ActivationFunction;
                Layers.push(layer);
				s.push(layer.State);
                ParameterCount += layer.ParameterCount;
                size = layer.outputSize;
            } else if (options[i].Flatten) {
                var layer = new self.FlattenLayer({inputSize:size,no3D:options[i].no3D,ActivationFunction:act});
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].UnFlatten) {
                var layer = new self.UnFlattenLayer({inputSize:size,outputSize:options[i].outputSize,ActivationFunction:act});
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].Dense) {
                var layer = new self.DenseLayer({inputSize:size,outputs:options[i].outputs,ActivationFunction:options[i].ActivationFunction});
				p.push(layer.Parameters);
				g.push(layer.Gradent);
                act = options[i].ActivationFunction;
                ParameterCount += layer.ParameterCount;
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].TemporalShift) {
                var layer = new self.TemporalShiftLayer({inputSize:size,depth:options[i].depth,ActivationFunction:act});
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].SelfAttention) {
                var layer = new self.SelfAttentionLayer({inputSize:size,depth:options[i].depth,queryKeyDims:options[i].queryKeyDims,valueDims:options[i].valueDims,mask:options[i].mask,noRisid:options[i].noRisid,m:options[i].m,ActivationFunction:act});
				p.push(layer.Parameters);
				s.push(layer.State);
				g.push(layer.Gradent);
				act = 0;
				ParameterCount += layer.ParameterCount;
                Layers.push(layer);
                size = layer.outputSize;
            } else if (options[i].Tokenize) {
                var layer = new self.TokenizeLayer({inputSize:size,level:options[i].level,ActivationFunction:act});
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].FixedAttention) {
                var layer = new self.FixedAttentionLayer({inputSize:size,heads:options[i].heads,queryKeyDims:options[i].queryKeyDims,valueDims:options[i].valueDims,mask:options[i].mask,m:options[i].m,ActivationFunction:act});
				p.push(layer.Parameters);
				g.push(layer.Gradent);
				act = 0;
				ParameterCount += layer.ParameterCount;
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].Normalize) {
                var layer = new self.NormalizeLayer({ActivationFunction:act});
                Layers.push(layer);
				s.push(layer.State);
            } else if (options[i].MultiHeadedSelfAttention) {
                var layer = new self.MultiHeadedSelfAttentionLayer({inputSize:size,heads:options[i].heads,queryKeyDims:options[i].queryKeyDims,valueDims:options[i].valueDims,mask:options[i].mask,noRisid:options[i].noRisid,m:options[i].m,ActivationFunction:act});
				p.push(layer.Parameters);
				g.push(layer.Gradent);
				act = 0;
				ParameterCount += layer.ParameterCount;
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].IndexStamp) {
                var layer = new self.IndexStampLayer({inputSize:size,vertical:options[i].vertical,ActivationFunction:act});
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].FRU) {
                var layer = new self.FourierRecurrentUnit({inputSize:size,stateOutputs:options[i].stateOutputs,outputs:options[i].outputs,Falloff:options[i].Falloff,m:options[i].m,ActivationFunction:act});
				p.push(layer.Parameters);
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
			} else if (options[i].SimpleRecurrentAttention) {
                var layer = new self.SimpleRecurrentAttention({inputSize:size,queryKeyDims:options[i].outputs,valueDims:options[i].outputs,noRisid:options[i].noRisid,m:options[i].m,ActivationFunction:act});
                Layers.push(layer);
				ParameterCount += layer.ParameterCount;
				p.push(layer.Parameters);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].MultiHeadedRecurrentAttention) {
                var layer = new self.MultiHeadedRecurrentAttention({inputSize:size,queryKeyDims:options[i].queryKeyDims,valueDims:options[i].valueDims,recurrency:options[i].recurrency,heads:options[i].heads,noRisid:options[i].noRisid,m:options[i].m,ActivationFunction:act});
                Layers.push(layer);
				ParameterCount += layer.ParameterCount;
				p.push(layer.Parameters);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].TimedIndexStamp) {
                var layer = new self.TimedIndexStampLayer({inputSize:size,vertical:options[i].vertical,ActivationFunction:act});
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].FullMultiHeadedSelfAttention) {
                var layer = new self.FullMultiHeadedSelfAttentionLayer({inputSize:size,heads:options[i].heads,queryKeyDims:options[i].queryKeyDims,valueDims:options[i].valueDims,mask:options[i].mask,noRisid:options[i].noRisid,m:options[i].m,ActivationFunction:act});
				p.push(layer.Parameters);
				g.push(layer.Gradent);
				act = 0;
				ParameterCount += layer.ParameterCount;
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].ResidNormReluLayers) {
                var layer = new self.ResidNormReluLayers({inputSize:size,layers:options[i].layers,ActivationFunction:act});
				p.push(layer.Parameters);
				act = 0;
				ParameterCount += layer.ParameterCount;
                Layers.push(layer);
				s.push(layer.State);
            } else if (options[i].MemoryOptimizedMultiHeadedSelfAttentionLayer) {
                var layer = new self.MemoryOptimizedMultiHeadedSelfAttentionLayer({inputSize:size,heads:options[i].heads,queryKeyDims:options[i].queryKeyDims,valueDims:options[i].valueDims,mask:options[i].mask,noRisid:options[i].noRisid,m:options[i].m,ActivationFunction:act});
				p.push(layer.Parameters);
				g.push(layer.Gradent);
				act = 0;
				ParameterCount += layer.ParameterCount;
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            } else if (options[i].FullMemoryOptimizedMultiHeadedSelfAttentionLayer) {
                var layer = new self.FullMemoryOptimizedMultiHeadedSelfAttentionLayer({inputSize:size,heads:options[i].heads,queryKeyDims:options[i].queryKeyDims,valueDims:options[i].valueDims,mask:options[i].mask,noRisid:options[i].noRisid,m:options[i].m,ActivationFunction:act});
				p.push(layer.Parameters);
				g.push(layer.Gradent);
				act = 0;
				ParameterCount += layer.ParameterCount;
                Layers.push(layer);
				s.push(layer.State);
                size = layer.outputSize;
            }
			// FullMemoryOptimizedMultiHeadedSelfAttentionLayer
			// recurrency
        }
		var funct0 = function(Input) {
			for (var i=0; i<Layers.length; i++) {
				try {
					Input = Layers[i].call(Input);
				} catch(err) {
					console.error(Layers[i]);
					throw new Error("Error at Layer "+i);
				}
			}
			return Input;
		}
		var funct1 = function(grad,prevAct) {
			for (var i=Layers.length-1; i>=0; i--) {
				grad = Layers[i].backprop(grad,(Layers[i-1] || {ActivationFunction:prevAct}).ActivationFunction);
			}
			return grad;
		}
		var funct2 = function(lr) {
			for (var i=0; i<Layers.length; i++) {
				Layers[i].finnishBatch(lr);
			}
		}
		var funct3 = function() {
			for (var i=0; i<Layers.length; i++) {
				if (Layers[i].reset) {
					Layers[i].reset();
				}
			}
		}
		p = new self.Parameters(p);
		s = new self.State(s);
		g = new self.Gradents(g);
        return {outputSize:size,Layers:Layers,call:funct0,backprop:funct1,reset:funct3,finnishBatch:funct2,ParameterCount:ParameterCount,State:s,Parameters:p,Gradent:g};
    }
	this.positionalEncoding2DRaw = function(xy) {
		// 0.8660254037844387
		// 2.598076211353316
		// 4.1887902047863905
		return 0.3849001794597505*(Math.sin(xy[0]*4.1887902047863905)+Math.sin((3.6275987284684357*xy[1])-(2.0943951023931953*xy[0]))-Math.sin((3.6275987284684357*xy[1])+(2.0943951023931953*xy[0])));
	}
	this.positionalEncoding2D = function(xy,dims) {
		xy = xy.slice();
		var result = new Float32Array(dims);
		for (var i=0; i<dims; i++) {
			if (i%3 === 0) {
				result[i] = self.positionalEncoding2DRaw(xy);
			} else if (i%3 === 1) {
				xy[0]++;
				result[i] = self.positionalEncoding2DRaw(xy);
			} else {
				xy[0]++;
				result[i] = self.positionalEncoding2DRaw(xy);
				xy[0] -= 2;
				xy[0] *= 2;
				xy[1] *= 2;
			}
		}
		return result;
	}
	this.Tokens = [];
	this.WordEmbedingDims = opts.wordEmbedingDims;
	this.WordEmbedingCaseSensitive = opts.WordEmbedingCaseSensitive;
	this.Embeddings = [];
	this.EmbeddingsPerToken = 1;
	this.randomEmbedding = function() {
		return new Float32Array(self.WordEmbedingDims).map(self.randn);
	}
	this.initalizeTokensAndEmbeddings = function(tokens,embeddingsPerToken) {
		self.Tokens = tokens;
		self.EmbeddingsPerToken = embeddingsPerToken;
		var EmbeddingCount = Math.ceil(self.Tokens.length**(1/embeddingsPerToken))+1;
		self.Embeddings = new Array(EmbeddingCount);
		for (var i=0; i<EmbeddingCount; i++) {
			self.Embeddings[i] = self.randomEmbedding();
		}
		self.NullToken = self.Embeddings[0];
		return EmbeddingCount;
	}
	this.textToIndexs = function(text,len) {
		if (!self.WordEmbedingCaseSensitive) {
			text = text.toLowerCase();
		}
		len = len || Infinity;
		var result = [];
		var step = 0;
		var iteration = 0;
		while (text.length > 0 && iteration < len) {
			var maxval = 0;
			var maxidx = -1;
			for (var i=0; i<self.Tokens.length; i++) {
				var tkn = self.Tokens[i];
				if (tkn.length > maxval) {
					if (text.startsWith(tkn)) {
						maxval = tkn.length;
						maxidx = i;
					}
				}
			}
			//result.push(text.slice(0,maxval));
			if (maxidx >= 0) {
				// console.log(maxval,maxidx,text.slice(0,10));
				text = text.slice(maxval);
				for (var i=0; i<self.EmbeddingsPerToken; i++) {
					var id = (Math.floor(maxidx/((self.Embeddings.length-1)**i))%(self.Embeddings.length-1))+1;
					//result.push(self.Embeddings[id]);
					result.push(id);
					step++;
				}
				iteration++;
			} else {
				text = text.slice(1);
			}
		}
		return result;
	}
	this.textToArray = function(text,len) {
		var indexs = self.textToIndexs(text,len);
		var result = [];
		for (var i=0; i<indexs.length; i++) {
			result.push(self.Embeddings[indexs[i]]);
		}
		return result;
	}
	this.textToFlattenedArray = function(text,len) {
		var item = self.textToArray(text,len);
		var result = new Float32Array(item.length*self.WordEmbedingDims);
		for (var j=0; j<item.length; j++) {
			result.set(item[j],j*self.WordEmbedingDims);
		}
		return result;
	}
	this.textToData = function(text,len) {
		var indexs = self.textToIndexs(text,len);
		var result = [];
		for (var i=0; i<indexs.length; i++) {
			result.push(self.Embeddings[indexs[i]]);
		}
		return {indexs:indexs,embeddings:result};
	}
	this.embeddingToIndex = function(embedding) {
		var maxidx = 0;
		var maxval = -Infinity;
		for (var i=1; i<self.Embeddings.length; i++) {
			var v = 0;
			for (var j=0; j<self.Embeddings[i].length && v <= maxval; j++) {
				v += embedding[j]*self.Embeddings[i][j];
			}
			if (v > maxval) {
				maxidx = i;
				maxval = v;
			}
		}
		return maxidx;
	}
	this.roundEmbedding = function(embedding) {
		var maxidx = -1;
		var maxval = -Infinity;
		for (var i=1; i<self.Embeddings.length; i++) {
			var v = 0;
			for (var j=0; j<self.Embeddings[i].length; j++) {
				v += embedding[j]*self.Embeddings[i][j];
			}
			if (v > maxval) {
				maxidx = i;
				maxval = v;
			}
		}
		return self.Embeddings[maxidx];
	}
	this.roundEmbeddingData = function(embedding) {
		var maxidx = -1;
		var maxval = -Infinity;
		for (var i=1; i<self.Embeddings.length; i++) {
			var v = 0;
			for (var j=0; j<self.Embeddings[i].length; j++) {
				v += embedding[j]*self.Embeddings[i][j];
			}
			if (v > maxval) {
				maxidx = i;
				maxval = v;
			}
		}
		return {Embedding:self.Embeddings[maxidx],Index:maxidx,MaxDot:maxval};
	}
	this.arrayToIndexs = function(arr) {
		var indexs = [];
		for (var j=0; j<arr.length; j++) {
			indexs.push(self.embeddingToIndex(arr[j]));
		}
		return indexs;
	}
	this.arrayToText = function(arr) {
		return self.indexsToText(self.arrayToIndexs(arr));
	}
	this.indexsToText = function(indexs) {
		var idx = 0;
		var newindexs = [];
		var maxsubidx = self.EmbeddingsPerToken-1;
		for (var i=0; i<indexs.length; i++) {
			// Math.floor(maxidx/(self.Embeddings.length**i))%self.Embeddings.length
			var subidx = i%self.EmbeddingsPerToken;
			if (subidx === 0) {
				idx = indexs[i]-1;
			} else {
				idx += (indexs[i]-1)*((self.Embeddings.length-1)**subidx);
			}
			if (subidx === maxsubidx) {
				newindexs.push(idx);
			}
		}
		var result = "";
		for (var i=0; i<newindexs.length; i++) {
			result += self.Tokens[newindexs[i]];
		}
		return result;
	}
	this.flattenedArrayToText = function(arr) {
		var a = [];
		for (var i=0; i<arr.length; i+=self.WordEmbedingDims) {
			a.push(arr.subarray(i,i+self.WordEmbedingDims));
		}
		return self.arrayToText(a);
	}
	this.softMax = function(arr) {
		var sum = 0;
		var result = new Float32Array(arr.length);
		for (var i=0; i<arr.length; i++) {
			result[i] = Math.exp(arr[i]);
			sum += result[i];
		}
		for (var i=0; i<arr.length; i++) {
			result[i] /= sum;
		}
		return result;
	}
	this.softMaxBackprop = function(grad,arr) {
		var sum = 0;
		var result = new Float32Array(arr.length);
		for (var i=0; i<arr.length; i++) {
			sum += grad[i]*arr[i];
		}
		for (var i=0; i<arr.length; i++) {
			result[i] = ((grad[i]*(1-arr[i]))+(grad[i]*arr[i]))-sum;
		}
		return result;
	}
	this.parseCSV = function(text,hasHeader) {
		var data = text.replaceAll("\r\n","\n").split("\n");
		if (!data[data.length-1]) {
			data.pop();
		}
		var header = [];
		// /([^\d\.])/
		if (hasHeader) {
			var item = data.splice(0,1)[0].split(',"');
			header = item[0].split(",");
			for (var j=1; j<item.length; j++) {
				var idx = item[j].indexOf('",');
				var len = 2;
				if (idx === -1) {
					idx = item[j].indexOf('"');
					len = 1;
					if (idx === -1) {
						idx = item[j].length;
					}
				}
				header.push(item[j].slice(0,idx));
				idx += len;
				if (item[j].length > idx) {
					header = header.concat(item[j].slice(idx).split(","));
				}
			}
			for (var i=0; i<data.length; i++) {
				var item = data[i].split(',"');
				data[i] = item[0].split(",");
				for (var j=1; j<item.length; j++) {
					var idx = item[j].indexOf('",');
					var len = 2;
					if (idx === -1) {
						idx = item[j].indexOf('"');
						len = 1;
						if (idx === -1) {
							idx = item[j].length;
						}
					}
					data[i].push(unescape(item[j].slice(0,idx)));
					idx += len;
					if (item[j].length > idx) {
						data[i] = data[i].concat(item[j].slice(idx).split(","));
					}
				}
				var o = {};
				var loop = Math.min(data[i].length,header.length);
				for (var j=0; j<loop; j++) {
					if (!(/([^\d\.])/).test(data[i][j]) && data[i][j].split(".").length <= 2) {
						var v = parseFloat(data[i][j]);
						if (!isNaN(v)) {
							data[i][j] = v;
						}
					}
					o[header[j]] = data[i][j];
				}
				data[i] = o;
			}
			return {data:data,header:header};
		} else {
			for (var i=0; i<data.length; i++) {
				var item = data[i].split(',"');
				data[i] = item[0].split(",");
				for (var j=1; j<item.length; j++) {
					var idx = item[j].indexOf('",');
					var len = 2;
					if (idx === -1) {
						idx = item[j].indexOf('"');
						len = 1;
						if (idx === -1) {
							idx = item[j].length;
						}
					}
					data[i].push(unescape(item[j].slice(0,idx)));
					idx += len;
					if (item[j].length > idx) {
						data[i] = data[i].concat(item[j].slice(idx).split(","));
					}
				}
				for (var j=0; j<data[i].length; j++) {
					if (!(/([^\d\.])/).test(data[i][j]) && data[i][j].split(".").length <= 2) {
						var v = parseFloat(data[i][j]);
						if (!isNaN(v)) {
							data[i][j] = v;
						}
					}
				}
			}
			return data;
		}
	}
}