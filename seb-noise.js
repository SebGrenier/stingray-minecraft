define(['lodash'], function(_) {
    'use strict';

    function vectorLength (vector) {
        var temp = 0;
        for (var i = 0; i < vector.length; ++i) {
            temp += vector[i] * vector[i];
        }

        return Math.sqrt(temp);
    }

    function randomUnitVector() {
        var vector = [Math.random(), Math.random(), Math.random()];
        var length = vectorLength(vector);
        for (var i = 0; i < vector.length; ++i) {
            vector[i] = vector[i] / length;
        }
        return vector;
    }

    function fastfloor (x) {
        //return x > 0 ? (int)x : (int)x-1;
        return Math.floor(x);
    }

    function dot(g, x, y, z) {
        return g[0]*x + g[1]*y + g[2]*z;
    }

    function mix(a, b, t) {
        return (1-t)*a + t*b;
    }

    function fade(t) {
        return t*t*t*(t*(t*6-15)+10);
    }

    function CellData (gradients) {
        this.gradients = _.clone(gradients, true);
    }

    CellData.prototype = {
        gradient: function (index) {
            if (index < 8) {
                return this.gradients[index];
            }
            return [0, 0, 0];
        }
    };

    function SebNoise () {
        this._sizeX = 1;
        this._sizeY = 1;
        this._sizeZ = 1;
    }

    SebNoise.prototype = {
        _cellIndex: function (x, y, z) {
            return ((z * this._sizeY) + y) * this._sizeX + x;
        },

        generateGradients: function (sizeX, sizeY, sizeZ) {
            this._sizeX = sizeX;
            this._sizeY = sizeY;
            this._sizeZ = sizeZ;

            var nbCells = sizeX * sizeY * sizeZ;
            this._cells = new Array(nbCells);

            var lastIndex = -1;
            for (var z = 0; z < sizeZ; ++z) {
                for (var y = 0; y < sizeY; ++y) {
                    for (var x = 0; x < sizeX; ++x) {
                        // Not fast but easier to read and write
                        var gradients = [randomUnitVector(), randomUnitVector(), randomUnitVector(), randomUnitVector(),
                            randomUnitVector(), randomUnitVector(), randomUnitVector(), randomUnitVector()];
                        if (x > 0) {
                            lastIndex = this._cellIndex(x-1, y, z);
                            gradients[0] = this._cells[lastIndex].gradient(4);
                            gradients[1] = this._cells[lastIndex].gradient(5);
                            gradients[2] = this._cells[lastIndex].gradient(6);
                            gradients[3] = this._cells[lastIndex].gradient(7);
                        }

                        if (y > 0) {
                            lastIndex = this._cellIndex(x, y-1, z);
                            gradients[0] = this._cells[lastIndex].gradient(1);
                            gradients[2] = this._cells[lastIndex].gradient(3);
                            gradients[4] = this._cells[lastIndex].gradient(5);
                            gradients[6] = this._cells[lastIndex].gradient(7);
                        }

                        if (z > 0) {
                            lastIndex = this._cellIndex(x, y, z-1);
                            gradients[0] = this._cells[lastIndex].gradient(2);
                            gradients[1] = this._cells[lastIndex].gradient(3);
                            gradients[4] = this._cells[lastIndex].gradient(6);
                            gradients[5] = this._cells[lastIndex].gradient(7);
                        }
                        var cd = new CellData(gradients);
                        this._cells[this._cellIndex(x, y, z)] = cd;
                    }
                }
            }
        },

        noise: function (x, y, z) {
            x = x % this._sizeX;
            y = y % this._sizeY;
            z = z % this._sizeZ;

            var cellIndex = this._cellIndex(x, y, z);
            var cellData = this._cells[cellIndex];

            // Calculate noise contributions from each of the eight corners
            var n000= dot(cellData.gradient(0), 0.5, 0.5, 0.5);
            var n100= dot(cellData.gradient(1), 0.5, 0.5, 0.5);
            var n010= dot(cellData.gradient(2), 0.5, 0.5, 0.5);
            var n110= dot(cellData.gradient(3), 0.5, 0.5, 0.5);
            var n001= dot(cellData.gradient(4), 0.5, 0.5, 0.5);
            var n101= dot(cellData.gradient(5), 0.5, 0.5, 0.5);
            var n011= dot(cellData.gradient(6), 0.5, 0.5, 0.5);
            var n111= dot(cellData.gradient(7), 0.5, 0.5, 0.5);

            // Compute the fade curve value for each of x, y, z
            var u = fade(0.5);
            var v = fade(0.5);
            var w = fade(0.5);

            // Interpolate along x the contributions from each of the corners
            var nx00 = mix(n000, n100, u);
            var nx01 = mix(n001, n101, u);
            var nx10 = mix(n010, n110, u);
            var nx11 = mix(n011, n111, u);

            // Interpolate the four results along y
            var nxy0 = mix(nx00, nx10, v);
            var nxy1 = mix(nx01, nx11, v);

            // Interpolate the two last results along z
            var nxyz = mix(nxy0, nxy1, w);

            return nxyz;
        }
    };

    return SebNoise;
});
