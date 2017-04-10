define([
    'app',
    'stingray',
    'lodash',
    '3rdparty/sprintf/sprintf.min',
    'common/lua-utils',
    'common/gl-utils',
    'services/engine-service',
    'services/file-system-service',
    './classic-noise',
    './simplex-noise',
    './seb-noise'
    ], function (app, stingray, _, sprintf, luaUtils, glUtils, engineService, fileSystemService, ClassicNoise, SimplexNoise, SebNoise) {
    'use strict';

    var gl = null;
    var textureQuadBuffers = {};
    var textureShader;
    var mvMatrix;
    var perspectiveMatrix;
    var heightmapTexId = null;


    function heightMapToUint8Array(heightmap) {
        var sizeY = heightmap.length;
        var sizeX = heightmap[0].length;
        // Must pad to the UNPACK_ALIGNMENT or the texture won't be displayed
        var unpackAlignment = gl.getParameter(gl.UNPACK_ALIGNMENT);
        var unpaddedRowSize = sizeX * 1;
        var paddedRowSize = Math.floor((sizeX + unpackAlignment - 1) / unpackAlignment)  * unpackAlignment;
        var sizeNeeded = paddedRowSize * (sizeY - 1) + unpaddedRowSize;
        var pixels = new Uint8Array(sizeNeeded);
        var index = 0;
        for (var y = 0; y < sizeY; ++y) {
            index = y * paddedRowSize;
            for (var x = 0; x < sizeX; ++x) {
                pixels[index + x] = Math.floor(heightmap[y][x] * 255);
            }
        }
        return pixels;
    }

    function initWebGL (canvas) {
        var gl = null;

        try {
            gl = canvas.getContext("webgl");
        }
        catch(e) {
        }

        if (!gl) {
            alert("Unable to initialize WebGL. Your browser may not support it.");
        } else {
            var vertices = new Array(12);
            var texCoords = new Array(8);
            var indices = new Array(6);
            vertices[0] = -1.0;
            vertices[1] = -1.0;
            vertices[2] = 0.0;
            vertices[3] = -1.0;
            vertices[4] = 1.0;
            vertices[5] = 0.0;
            vertices[6] = 1.0;
            vertices[7] = 1.0;
            vertices[8] = 0.0;
            vertices[9] = 1.0;
            vertices[10] = -1.0;
            vertices[11] = 0.0;

            texCoords[0] = 0.0;
            texCoords[1] = 0.0;
            texCoords[2] = 0.0;
            texCoords[3] = 1.0;
            texCoords[4] = 1.0;
            texCoords[5] = 1.0;
            texCoords[6] = 1.0;
            texCoords[7] = 0.0;

            indices[0] = 0;
            indices[1] = 1;
            indices[2] = 2;
            indices[3] = 2;
            indices[4] = 3;
            indices[5] = 0;

            var positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);

            var textureBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

            var indexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

            textureQuadBuffers = {
                position: positionBuffer,
                texCoords: textureBuffer,
                index: indexBuffer
            }
        }
        return gl;
    }

    function initShaders () {
        textureShader = initShader("shader-vs", "shader-fs", null, ['aVertexPosition', 'aVertexTexCoord']);
    }

    function initShader (vertexShader, fragmentShader, uniforms, attributes) {
        uniforms = uniforms || [];
        attributes = attributes || [];

        var fragmentShaderProg = getShader(gl, fragmentShader);
        var vertexShaderProg = getShader(gl, vertexShader);

        // Create the shader program

        var shaderProgram = gl.createProgram();
        gl.attachShader(shaderProgram, vertexShaderProg);
        gl.attachShader(shaderProgram, fragmentShaderProg);
        gl.linkProgram(shaderProgram);

        // If creating the shader program failed, alert
        if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
            alert("Unable to initialize the shader program.");
        }

        gl.useProgram(shaderProgram);

        var uniformLocations = {};
        // for (var uniform of uniforms) {
        //
        // }

        var attributeLocations = {};
        for (var attribute of attributes) {
            var attributeLocation = gl.getAttribLocation(shaderProgram, attribute);
            gl.enableVertexAttribArray(attributeLocation);
            attributeLocations[attribute] = attributeLocation;
        }

        gl.useProgram(null);

        return {
            shaderProgram: shaderProgram,
            uniformLocations: uniformLocations,
            attributeLocations: attributeLocations
        };
    }

    function getShader (gl, id) {
        var shaderScript = document.getElementById(id);

        // Didn't find an element with the specified ID; abort.

        if (!shaderScript) {
            return null;
        }

        // Walk through the source element's children, building the
        // shader source string.

        var theSource = "";
        var currentChild = shaderScript.firstChild;

        while(currentChild) {
            if (currentChild.nodeType == 3) {
                theSource += currentChild.textContent;
            }

            currentChild = currentChild.nextSibling;
        }

        // Now figure out what type of shader script we have,
        // based on its MIME type.

        var shader;

        if (shaderScript.type == "x-shader/x-fragment") {
            shader = gl.createShader(gl.FRAGMENT_SHADER);
        } else if (shaderScript.type == "x-shader/x-vertex") {
            shader = gl.createShader(gl.VERTEX_SHADER);
        } else {
            return null;  // Unknown shader type
        }

        // Send the source to the shader object

        gl.shaderSource(shader, theSource);

        // Compile the shader program

        gl.compileShader(shader);

        // See if it compiled successfully

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            alert("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
            return null;
        }

        return shader;
    }

    function loadIdentity () {
        mvMatrix = Matrix.I(4);
    }

    function multMatrix (m) {
        mvMatrix = mvMatrix.x(m);
    }

    function mvTranslate (v) {
        multMatrix(Matrix.Translation($V([v[0], v[1], v[2]])).ensure4x4());
    }

    function setMatrixUniforms (shaderProgram) {
        var pUniform = gl.getUniformLocation(shaderProgram, "uPMatrix");
        gl.uniformMatrix4fv(pUniform, false, new Float32Array(perspectiveMatrix.flatten()));

        var mvUniform = gl.getUniformLocation(shaderProgram, "uMVMatrix");
        gl.uniformMatrix4fv(mvUniform, false, new Float32Array(mvMatrix.flatten()));
    }

    function drawScene () {
        if (!heightmapTexId) {
            requestAnimationFrame(drawScene);
            return;
        }

        // Clear the canvas before we start drawing on it.
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        perspectiveMatrix = glUtils.makeOrtho(-1, 1, -1, 1, 0.0, 1.0);

        loadIdentity();


        gl.useProgram(textureShader.shaderProgram);
        setMatrixUniforms(textureShader.shaderProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(gl.getUniformLocation(textureShader.shaderProgram, "texture"), 0);

        gl.bindTexture(gl.TEXTURE_2D, heightmapTexId);

        gl.bindBuffer(gl.ARRAY_BUFFER, textureQuadBuffers.position);
        gl.vertexAttribPointer(textureShader.attributeLocations['aVertexPosition'], 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, textureQuadBuffers.texCoords);
        gl.vertexAttribPointer(textureShader.attributeLocations['aVertexTexCoord'], 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, textureQuadBuffers.index);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

        // request draw frame
        requestAnimationFrame(drawScene);
    }

    function generateTextureFromHeightMap(heightmap) {
        var sizeY = heightmap.length;
        var sizeX = heightmap[0].length;
        var pixels = heightMapToUint8Array(heightmap);
        var texId = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texId);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, sizeX, sizeY, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels);
        // make sure we can render it even if it's not a power of 2
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return texId;
    }

    function vector3ToLua(vec) {
        return 'stingray.Vector3( ' + vec.x + ', ' + vec.y + ', ' + vec.z + ')';
    }

    function quaternionToLua(quat) {
        return 'stingray.Quaternion.from_elements( ' + quat.x + ', ' + quat.y + ', ' + quat.z + ', ' + quat.w + ')';
    }

    function sine2d (x, y, t, options) {
        t = t || 1;
        return options.sineXAmplitude * Math.sin(x * t * options.sineXPeriod + options.sineXOffset) *
            options.sineYAmplitude * Math.sin(y * t * options.sineYPeriod + options.sineYOffset);
    }

    function createArray(length) {
        var arr = new Array(length || 0),
            i = length;

        if (arguments.length > 1) {
            var args = Array.prototype.slice.call(arguments, 1);
            while(i--) arr[length-1 - i] = createArray.apply(this, args);
        }

        return arr;
    }

    function isOdd(number) {
        return number % 2 !== 0;
    }

    function Kernel(sizeX, sizeY) {
        this._data = createArray(sizeY, sizeX);
        this.sizeX = sizeX;
        this.sizeY = sizeY;
        this.halfSizeX = Math.floor(sizeX / 2);
        this.halfSizeY = Math.floor(sizeY / 2);
    }

    Kernel.prototype.offset = function(offsetY, offsetX, value) {
        if (value)
            return this._data[offsetY + this.halfSizeY][offsetX + this.halfSizeX] = value;

        return this._data[offsetY + this.halfSizeY][offsetX + this.halfSizeX];
    };

    Kernel.prototype.normalize = function () {
        var sum = 0;
        for (var y = 0; y < this.sizeY; ++y) {
            for (var x = 0; x < this.sizeX; ++x) {
                sum += this._data[y][x];
            }
        }
        for (var y = 0; y < this.sizeY; ++y) {
            for (var x = 0; x < this.sizeX; ++x) {
                this._data[y][x] = this._data[y][x] / sum;
            }
        }
    };

    function gaussianKernel(sizeX, sizeY, sigma) {
        if (!isOdd(sizeY) || !isOdd(sizeX))
            throw 'Kernel size must be odd for symmetry';
        var kernel = new Kernel(sizeX, sizeY);
        var sigmaSquare = sigma * sigma;
        var expoScale = 1 / (2 * 3.14159 * sigmaSquare);
        for (var halfY = -kernel.halfSizeY; halfY <= kernel.halfSizeY; ++halfY) {
            for (var halfX = -kernel.halfSizeX; halfX <= kernel.halfSizeX; ++halfX) {
                var value = expoScale * Math.exp(-(halfX*halfX + halfY*halfY)/(2*sigmaSquare));
                kernel.offset(halfY, halfX, value);
            }
        }
        kernel.normalize();
        return kernel;
    }

    function imMinMax(image) {
        var sizeY = image.length;
        var sizeX = image[0].length;

        var min = 999;
        var max = -999;
        for (var y = 0; y < sizeY; ++y) {
            for (var x = 0; x < sizeX; ++x) {
                if (image[y][x] < min)
                    min = image[y][x];
                if (image[y][x] > max)
                    max = image[y][x];
            }
        }

        return {min: min, max: max};
    }

    function imStretch(image, newMin, newMax) {
        var sizeY = image.length;
        var sizeX = image[0].length;
        var newImage = createArray(sizeY, sizeX);
        var minMax = imMinMax(image);
        var scale = (newMax - newMin) / (minMax.max - minMax.min);
        for (var y = 0; y < sizeY; ++y) {
            for (var x = 0; x < sizeX; ++x) {
                newImage[y][x] = (image[y][x] - minMax.min) * scale + newMin;
            }
        }
        return newImage;
    }

    function applyKernelFunctor (image) {
        var sizeY = image.length;
        var sizeX = image[0].length;
        return function (y, x, kernel) {
            var value = 0;
            for (var offsetY = -kernel.halfSizeY; offsetY <= kernel.halfSizeY; ++offsetY) {
                if (y + offsetY < 0 || y + offsetY >= sizeY)
                    continue;
                for (var offsetX = -kernel.halfSizeX; offsetX <= kernel.halfSizeX; ++offsetX) {
                    if (x + offsetX < 0 || x + offsetX >= sizeX)
                        continue;
                    value += image[y + offsetY][x + offsetX] * kernel.offset(-offsetY, -offsetX); // This is a convolution, not a correlation! Also, should not normalize kernel and only divide by the contribution.
                }
            }
            return value;
        }
    }

    function imConvolve(image, kernel) {
        var sizeY = image.length;
        var sizeX = image[0].length;
        var newImage = createArray(sizeY, sizeX);
        var applyKernel = applyKernelFunctor(image);
        for (var y = 0; y < sizeY; ++y) {
            for (var x = 0; x < sizeX; ++x) {
                newImage[y][x] = applyKernel(y, x, kernel);
            }
        }
        return newImage;
    }

    function imGaussian(image, radius) {
        var sigma = radius / 2;
        var kernel = gaussianKernel(radius, radius, sigma);
        return imConvolve(image, kernel);
    }

    function toSyntax(obj) {
        if (obj === null || obj === undefined) {
            return "nil";
        }

        if (!_.isObject(obj)) {
            if (typeof obj === 'string') {
                return '"' + obj + '"';
            }
            return obj.toString();
        }

        if (obj.hasOwnProperty('toSyntax')) {
            return obj.toSyntax(obj);
        }

        var result = "{";
        var isArray = obj instanceof Array;
        var len = _.size(obj);
        var i = 0;
        _.forEach(obj, function (v, k) {
            if (isArray) {
                result += exports.toSyntax(v);
            } else {
                result += '["' + k + '"] = ' + exports.toSyntax(v);
            }
            if (i < len-1) {
                result += ",";
            }
            ++i;
        });
        result += "}";

        return result;
    }

    app.controller('minecraftTerrain', function ($scope) {

        var canvas = document.getElementById("canvas");
        gl = initWebGL(canvas);
        initShaders();


        var cubeResource = 'core/units/primitives/cube_primitive';
        var mountainMaterial = 'minecraft_resources/materials/rock';
        var grassMaterial = 'minecraft_resources/materials/grass';
        var dirtMaterial = 'minecraft_resources/materials/dirt';
        var snowMaterial = 'minecraft_resources/materials/snow';
        var noiseHandler = new SebNoise();
        var nbCubeSpawned = 0;

        $scope.sizeX = 20;
        $scope.sizeY = 20;
        $scope.sizeZ = 10;

        function simplexNoise(octaves, x, y, z) {
            var value = 0.0;
            for(var i = 0; i < octaves; i++) {
                value += noiseHandler.noise(
                    x*Math.pow(2, i),
                    y*Math.pow(2, i),
                    z*Math.pow(2, i)
                );
            }
            return value;
        }

        function simplexNoise2(octaves, x, y, z, noiseHandler) {
            var value = 0.0;
            for(var i = 0; i < octaves; i++) {
                var noise = noiseHandler.noise(x*Math.pow(2, i), y*Math.pow(2, i), z*Math.pow(2, i));
                value +=  noise / (i+1);
            }
            return value;
        }

        function generateDensity (x, y, z, sizeX, sizeY, sizeZ, densityThreshold) {
            var xf = x / sizeX;
            var yf = y / sizeY;
            var zf = z / sizeZ;
            var plateau_falloff = 1.0;
            var center_falloff = 1.0;
            var caves = 1.0;
            if(zf <= 0.8){
                plateau_falloff = 1.0;
            }
            else if(0.8 < zf && zf < 0.9){
                plateau_falloff = 1.0-(zf-0.8)*10.0;
            }
            else{
                plateau_falloff = 0.0;
            }

            center_falloff = 0.1/(
                    Math.pow((xf-0.5)*1.5, 2) +
                    Math.pow((yf-0.5)*1.5, 2) +
                    Math.pow((zf-1.0)*0.8, 2)
                );
            caves = Math.pow(simplexNoise(1, xf*5, yf*5, zf*5), 3);
            var density = (
                simplexNoise(5, xf, yf, zf*0.5) *
                center_falloff *
                plateau_falloff
            );
            density *= Math.pow(
                noiseHandler.noise((xf+1)*3.0, (yf+1)*3.0, (zf+1)*3.0)+0.4, 1.8
            );
            if(caves<0.5){
                density = 0;
            }

            return density > densityThreshold ? 1 : 0;
        }

        function generateTerrain (x, y, z, sizeX, sizeY, sizeZ, densityThreshold, heightMap, options) {
            var xf = x / sizeX;
            var yf = y / sizeY;
            var zf = z / sizeZ;

            var plateau_falloff = 1.0;
            var center_falloff = 1.0;
            var caves = 1.0;

            // if(zf <= 0.8){
            //     plateau_falloff = 1.0;
            // }
            // else if(0.8 < zf && zf < 0.9){
            //     plateau_falloff = 1.0-(zf-0.8)*10.0;
            // }
            // else{
            //     plateau_falloff = 0.0;
            // }

            //var height = /*sine2d(x, y, 1/5, options) * */simplexNoise2(1, x, y, 0, noiseHandler) / 2;
            var height = heightMap[y][x];
            if (zf > height)
                plateau_falloff = 0;

            // center_falloff = 0.1/(
            //         Math.pow((xf-0.5)*1.5, 2) +
            //         Math.pow((yf-0.5)*1.5, 2) +
            //         Math.pow((zf-1.0)*0.8, 2)
            //     );
            //caves = Math.pow(simplexNoise2(1, x*5, x*5, x*5, noiseHandler), 3);

            //var density = simplexNoise2(1, x, y, z, noiseHandler) * center_falloff * plateau_falloff * caves;
            var density = 1 * center_falloff * plateau_falloff * caves;

            return density < densityThreshold ? 0 : 1;
        }

        $scope.generate = function () {
            var sizeX = $scope.sizeX;
            var sizeY = $scope.sizeY;
            var sizeZ = $scope.sizeZ;
            var maxCubesPerCommand = 100;

            var dirtLimit = 0.4;
            var grassLimit = 0.6;
            var mountainLimit = 0.8;

            noiseHandler.generateGradients(sizeX, sizeY, 1);
            var heightMap = createArray(sizeY, sizeX);
            // Generate height map
            for (var y = 0; y < sizeY; ++y) {
                for (var x = 0; x < sizeX; ++x) {
                    heightMap[y][x] = noiseHandler.noise(x, y, 0);
                }
            }

            var newHeightMap = imStretch(heightMap, 0.0, 0.9);
            newHeightMap = imGaussian(newHeightMap, 5);
            newHeightMap = imStretch(newHeightMap, 0.0, 0.9);

            if (heightmapTexId) {
                gl.deleteTexture(heightmapTexId);
                heightmapTexId = null;
            }
            heightmapTexId = generateTextureFromHeightMap(newHeightMap);

            var options = {
                sineXOffset: Math.random(),
                sineXAmplitude: Math.random(),
                sineXPeriod: Math.random() * 3 + 0.1,
                sineYOffset: Math.random(),
                sineYAmplitude: Math.random(),
                sineYPeriod: Math.random() * 3 + 0.1,
            };

            var generatedUnits = [];
            for (var z = 0; z < sizeZ; z++) {
                for (var y = 0; y < sizeY; y++) {
                    for (var x = 0; x < sizeX; x++) {
                        var density = generateTerrain(x, y, z, sizeX, sizeY, sizeZ, 0.05, newHeightMap, options);

                        if (density > 0) {
                            var id = stingray.guid();
                            var position = {x:x - Math.floor(sizeX/2), y:y - Math.floor(sizeY/2), z:z - Math.floor(sizeZ/2), toSyntax: vector3ToLua};
                            var rotation = {x:0, y:0, z:0, w:1, toSyntax: quaternionToLua};
                            var scale = {x:1, y:1, z:1, toSyntax: vector3ToLua};
                            var pivot = {x:0, y:0, z:0, toSyntax: vector3ToLua};
                            var name = 'cube_' + nbCubeSpawned.toFixed();

                            var terrainMaterial = snowMaterial;
                            if (z / sizeZ < dirtLimit)
                                terrainMaterial = dirtMaterial;
                            else if (z / sizeZ < grassLimit)
                                terrainMaterial = grassMaterial;
                            else if (z / sizeZ < mountainLimit)
                                terrainMaterial = mountainMaterial;

                            generatedUnits.push({id: id, type: cubeResource, pos: position, rot: rotation, scale: scale, pivot: pivot, name: name, material: terrainMaterial, script_data: null});
                            nbCubeSpawned += 1;
                        }
                    }
                }
            }

            var chunks = _.chunk(generatedUnits, maxCubesPerCommand);
            chunks.reduce(function (previousResult, chunk) {
                return previousResult.then(function () {
                    return new Promise (function (resolve, reject) {
                        setTimeout(function () {
                            var spawnScript = 'local objs = {}\n' +
                                'for _, u in ipairs(%s) do\n' +
                                'LevelEditing:spawn_unit(u.id, u.type, u.pos, u.rot, u.scale, u.pivot, u.name, nil, u.script_data)\n' +
                                'LevelEditing:trigger_unit_spawned(u.id)\n' +
                                'local obj = LevelEditing.objects[u.id]\n' +
                                'obj:set_material("material", u.material)\n' +
                                'table.insert(objs, obj)\n' +
                                'end\n' +
                                'LevelEditing:spawned(objs)';
                            var luaParsedUnits = toSyntax(chunk);
                            return engineService.sendToEditors(spawnScript, luaParsedUnits).then(resolve);
                        }, 100);
                    });

                });
            }, Promise.resolve());
        };

        requestAnimationFrame(drawScene);
    });
});
