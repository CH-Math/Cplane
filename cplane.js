/*
 * Copyright (c) 2026 Christian Henriksen
 * Last updated 2026-11-04
 *
 * This file is part of Cplane.
 *
 * Cplane is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * Cplane is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Cplane. If not, see <https://www.gnu.org/licenses/>.
 *
 * Inspired by PPlane, but written from scratch.
 *
 * "Exports" only one function namely
 *   cplane.init
 */


let cplane = new function() {
    /* Configuration
     * change variables to get different behavior.
     */
    const initialGridPtsX = 29;
    const initialGridPtsY = 29;

    /* Arrowheads on the vector field.
     * The head is scaled by the flow speed measured in pixels, so it tapers
     * and finally vanishes where the field is small.
     */
    const arrowHeadMaxPx = 4.5;       // length at full (moderated) speed
    const arrowHeadWidthRatio = 0.55; // half-width relative to length
    const arrowHeadMinPx = 0.7;       // below this no head is drawn
    const arrowHeadAnchorPx = 1.5;    // how far back the tangent is measured

    /* The title in the top margin. It shrinks to fit the plot area and is
     * only condensed (fillText maxWidth) if shrinking alone is not enough.
     */
    const titleFontPx = 14;
    const titleFontMinPx = 10;

    // make room for labels
    const xOffset=88      // left margin. Wide enough for the rotated y label.
    const yOffset=36      // top margin, also holding the title
    const bottomMargin=72 // bottom margin, holding the tick labels and the
                          // x label. Chosen so that the plot area is exactly
                          // square: canvas height = width - 36, and
                          // 36 + 72 = 108 = 72 + 72.
    const axisFontPx=13   // axis names. Smaller and not bold: the title rules.
    const axisNameYx=16   // x position of the rotated y label

    // Colorblind safe colors
    const Wong = {
        "black": "rgb(0, 0, 0)",
        "orange": "rgb(230, 159, 0)",
        "skyBlue": "rgb(86, 180, 233)",
        "bluishGreen": "rgb(0, 158, 115)",
        "yellow": "rgb(240, 228, 66)",
        "blue": "rgb(0, 114, 178)",
        "vermillion": "rgb(213, 94, 0)",
        "reddishPurple": "rgb(204, 121, 167)"
    };
    
    /* "module" level variables */
    let xmin, xmax, ymin, ymax; // region in the plane
    let width, height;  // width and height of image in pixels
    let pixWidth, pixHeight; // width and height of a pixel
    let portraitElem; // canvas element
    let portrait; // canvas context
    let textOutElem; // text output
    let titleTxt = "mysys"; // title drawn above the phase portrait
    let xVarName = "x"; // names used for the axis labels
    let yVarName = "y";
    let f, fModerated; // vector field, and somewhat normalized vector field.
    let expressionsOkay=false; // until we verify them

    /*
     * Parsing
     */

    const VARIABLE = "variable";
    const FUNC = "funct";
    const NUMBER = "number";
    const LPAR = "lpar";
    const RPAR = "rpar";
    const OPERATOR = "operator";
    const UNRECOGNIZED = "unrecognized";

    function Token(type, value) {
        this.type = type;
        this.value = value;
    }

    const whitePat = /^\s+/;
    const funcPat = /^(sin|cos|tan|exp|log)\b/;
    const numberPat = /^(\d+\.?\d*|pi)/;
    const lparPat = /^\(/;
    const rparPat = /^\)/;
    const operatorPat = /^\*\*|^[+\-*/^]/;
    const variablePat = /^[a-zA-Z][a-zA-Z0-9]*/;
    const unrecognizedPat = /^./;

    const tokensRecognizer = [
        { pat: funcPat, type: FUNC },
        { pat: numberPat, type: NUMBER },
        { pat: lparPat, type: LPAR },
        { pat: rparPat, type: RPAR },
        { pat: operatorPat, type: OPERATOR },
        { pat: variablePat, type: VARIABLE },
        { pat: unrecognizedPat, type: UNRECOGNIZED }
    ];


    function lex(text) {
        let position = 0;
        let textLength = text.length;
        let tokens = []; 
        while ( position < textLength ) {
            let match = text.substring(position).match(whitePat);
            if ( match !== null ) {
                position = position + match[0].length;
            }
            else {
                for (let i=0; i<tokensRecognizer.length; i++) {
                    let recog = tokensRecognizer[i];
                    match = text.substring(position).match(recog.pat);
                    if ( match !== null ) {
                        tokens.push(new Token(recog.type, match[0]));
                        position = position + match[0].length;
                        if ( recog.type === UNRECOGNIZED ) {
                            throw "Lexer error, the sign " + match[0].substring(0,1) + " is not allowed.";
                        }
                        break;
                    }
                } // for
            }
        } // while
        return tokens;
    }

    // Parser

    // The parser builds an abstract syntax tree (AST).
    // Here are the classes

    // Summation
    class Sum {
        constructor(add1, add2) {
            this.addend1 = add1;
            this.addend2 = add2;
        }

        eval(env) {
            return this.addend1.eval(env) + this.addend2.eval(env);
        }

        toString() {
            return `(${this.addend1}+${this.addend2})`;
        }

        varNames() {
            return new Set(
                [...this.addend1.varNames(), ...this.addend2.varNames()]
            );
        }
    }

    // Difference
    class Difference {
        constructor(minuend, subtrahend) {
            this.minuend = minuend;
            this.subtrahend= subtrahend;
        }

        eval(env) {
            return this.minuend.eval(env) - this.subtrahend.eval(env);
        }

        toString() {
            return `(${this.minuend}-${this.subtrahend})`;
        }

        varNames() {
            return new Set(
                [...this.minuend.varNames(), ...this.subtrahend.varNames()]
            );
        }
    }

    // Product
    class Product {
        constructor(fac1, fac2) {
            this.factor1 = fac1;
            this.factor2 = fac2;
        }
    
        eval(env) {
            return this.factor1.eval(env) * this.factor2.eval(env);
        }

        toString() {
            return `(${this.factor1}*${this.factor2})`;
        }

        varNames() {
            return new Set(
                [...this.factor1.varNames(), ...this.factor2.varNames()]
            );
        }
    }


    // Quotient
    class Quotient {
        constructor(divident, divisor) {
            this.divident = divident;
            this.divisor = divisor;
        }

        eval(env) {
            return this.divident.eval(env) / this.divisor.eval(env);
        }

        toString() {
            return `(${this.divident}/${this.divisor})`;
        }

        varNames() {
            return new Set(
                [...this.divident.varNames(), ...this.divisor.varNames()]
            );
        }
    }

    // Power
    class Power {
        constructor(base, exponent) {
            this.base = base;
            this.exponent = exponent;
        }

        eval(env) {
            return Math.pow(this.base.eval(env), this.exponent.eval(env));
        }

        toString() {
            return `Math.pow(${this.base},${this.exponent})`;
        }

        varNames() {
            return new Set(
                [...this.base.varNames(), ...this.exponent.varNames()]
            );
        }
    }

    // Sin
    class Sin {
        constructor(arg) {
            this.arg = arg;
        }

        eval(env) {
            return Math.sin(this.arg.eval(env));
        }

        toString() {
            return `Math.sin(${this.arg})`;
        }
            
        varNames() {
            return this.arg.varNames(); 
        }
    }

    // Cos
    class Cos {
        constructor(arg) {
            this.arg = arg;
        }

        eval(env) {
            return Math.cos(this.arg.eval(env));
        }

        toString() {
            return `Math.cos(${this.arg})`;
        }

        varNames() {
            return this.arg.varNames(); 
        }

    }


    // Tan
    class Tan {
        constructor(arg) {
            this.arg = arg;
        }

        eval(env) {
            return Math.tan(this.arg.eval(env));
        }

        toString() {
            return `Math.tan(${this.arg})`;
        }

        varNames() {
            return this.arg.varNames(); 
        }
    }

    // Exp
    class Exp {
        constructor(arg) {
            this.arg = arg;
        }
        
        eval(env) {
            return Math.exp(this.arg.eval(env));
        }

        toString() {
            return `Math.exp(${this.arg})`;
        }

        varNames() {
            return this.arg.varNames(); 
        }
    }

    // Log
    class Log {
        constructor(arg) {
            this.arg = arg;
        }

        eval(env) {
            return Math.log(this.arg.eval(env));
        }

        toString() {
            return `Math.log(${this.arg})`;
        }

        varNames() {
            return this.arg.varNames(); 
        }
    }

    // Chs - change sign
    class Chs {
        constructor(arg) {
            this.arg = arg;
        }

        eval(env) {
            return -this.arg.eval(env);
        }

        toString() {
            return `(-${this.arg})`;
        }

        varNames() {
            return this.arg.varNames(); 
        }
    }
     
    // variable
    class Variable {
        constructor( name ) {
            this.name = name;
        }

        eval(env) {
            let res = env.get(this.name);
            if ( res === undefined ) {
                throw "Error evaluating expression, the variable " + this.name + " has no value";
            }
            return res;
        }
    
        toString() {
            return this.name;
        }

        varNames() {
            return new Set([this.name])
        }

    }

    // constant
    class Constant {
        constructor( value ) {
            this.value = value;
        }

        eval(env) {
            return this.value;
        }

        toString() {
            return this.value.toString();
        }

        varNames() {
            return new Set([]);
        }
    }



    // 
    // Here's the parser
    //

    // Auxiliary function
    function nextToken( tokens ) {
        if ( tokens.length === 0 ) {
            throw "Parser error: Unexpectedly ran out of tokens.";
        }
        return tokens[0];
    }

    // Toplevel
    function parseArith(tokens) {
        let res = parseExpression( tokens );
        if ( res.tokens.length > 0 ) {
            throw "Parser error: extra symbols at end of expression." + 
            + " Perhaps you need to put a multiplication sign";
        }
        return res.AST;
    }

    function parseExpression( tokens ) {
        let AST;
        let res;
        let next = nextToken( tokens );
        // We first deal with unary minus
        if ( next.type === OPERATOR && next.value === "-" ) {
             tokens.shift();
            res = parseTerm( tokens );
            AST = new Chs( res.AST );
        } else { 
            res = parseTerm( tokens );
            AST = res.AST;
        }
        tokens = res.tokens;

        next = tokens[0]; 
        while ( next !== undefined && next.type === OPERATOR 
            && (next.value === "+" || next.value === "-") )
        {
            tokens.shift();
            if ( next.value === "+" ) {
                res = parseTerm( tokens );
                AST = new Sum(AST, res.AST);
            }
            else {
                res = parseTerm( tokens );
                AST = new Difference(AST, res.AST);
            }
            tokens = res.tokens;
            next = tokens[0];
        } // while

        return { AST: AST, tokens: tokens };
    }


    function parseTerm( tokens ) {
        let res = parseFactor( tokens );
        let AST = res.AST;
        tokens = res.tokens;

        let next = tokens[0]; 
        while ( next != undefined && next.type === OPERATOR 
            && (next.value === "*" || next.value === "/") )
        {
            tokens.shift();
            if ( next.value === "*" ) {
                res = parseFactor( tokens );
                AST = new Product(AST, res.AST);
            }
            else { // divison
                res = parseFactor( tokens );
                AST = new Quotient(AST, res.AST);
            }
            tokens = res.tokens;
            next = tokens[0];
        } // while

        return { AST: AST, tokens: tokens };
    }

    function parseFactor( tokens ) {
        let res = parseFunExpr( tokens );
        let ASTs = [res.AST];
        tokens = res.tokens;

        let next = tokens[0]; 
        while ( next != undefined && next.type === OPERATOR 
            && (next.value === "^" || next.value === "**") )
        {
            tokens.shift();
            res = parseFunExpr( tokens );
            tokens = res.tokens;
            ASTs.push( res.AST );
            next = tokens[0];
        } // while

        // Since power is right-associative we combine from the right
        let k = ASTs.length - 1;
        let AST = ASTs[k];
        while ( k > 0 ) {
            k = k - 1;
            AST = new Power( ASTs[k], AST );
        }

        return {AST: AST, tokens: tokens};
    }


    function parseFunExpr( tokens ) {
        let next = nextToken( tokens );
        if (next.type !== FUNC) {
            return parsePrimary( tokens );
        }
        tokens.shift();
        let res = parseParExpression( tokens );
        switch ( next.value ) {
            case "sin":
                res.AST = new Sin( res.AST );
                break;
            case "cos":
                res.AST = new Cos( res.AST );
                break;
            case "tan":
                res.AST = new Tan( res.AST );
                break;
            case "exp":
                res.AST = new Exp( res.AST );
                break;
            case "log":
                res.AST = new Log( res.AST );
        }
        return res;
    }

    function parsePrimary( tokens ) {
        let next = nextToken( tokens );
        if ( next.type === LPAR ) {
            return parseParExpression( tokens );
        }
        tokens.shift();
        let AST;
        switch ( next.type) {
            case NUMBER: 
                let value = ( next.value === "pi" ? Math.PI : Number(next.value) );
                AST = new Constant( value );
                break;
            case VARIABLE:
                AST = new Variable( next.value );
                break;
            default:
                throw "Parser error: Epected variable name or a number here.";
        }

        return { AST: AST, tokens: tokens };
    }
        

    function parseParExpression( tokens ) {
        let next = nextToken( tokens );
        tokens.shift();
        if ( next.type !== LPAR ) {
            throw "Parser error: Expected a left parenthesis.";
        }
        let res = parseExpression( tokens );
        next = nextToken( res.tokens );
        res.tokens.shift();
        if ( next.type !== RPAR ) {
            throw "Parser error: Expected a right parenthesis.";
        }
        return res;
    }

    function lexAndParse( text ) {
        return parseArith( lex( text ) );
    }
    /* This concludes the parser */



    /* Logging info to the user.
     * We log to the element textOutElem, stored in a global variable of 
     * same name. */
    function logTxt(txt) {
        // We append a newline
        textOutElem.innerHTML = textOutElem.innerHTML + txt + "\n";
        // Scroll to bottom
        textOutElem.scrollTop = textOutElem.scrollHeight; 
    }


    /* 2D vectors and 2 by 2 matrices 
      We implement 2D vectors as array V = [v1, v2]
      and 2 by 2 matrices as an array A = [a11, a21, a12, a22],
      that is in column major order (or Fortran order)
    
    */
    let mat22 = new function() {

         
        /* We define som auxilary functions . */
        this.vectorAdd = function(v1, v2) {
            return [v1[0]+v2[0], v1[1]+v2[1]];
        };

        this.vectorSub = function(v1, v2) {
            return [v1[0]-v2[0], v1[1]-v2[1]];
        };

        this.scalarMul = function(k, [vx, vy]) {
            return [k*vx, k*vy];
        };

        this.dot = function(v1, v2) {
            return v1[0] * v2[0] + v1[1] * v2[1]; 
        };

        this.vectorNorm = function([vx, vy]) {
            return Math.sqrt(vx*vx + vy*vy);
        }

        // A moderated vector has max length 1
        this.moderate=function([vx, vy]) {
            let vLength = Math.pow(
                Math.pow( (vx / pixWidth), 2) + Math.pow( (vy / pixHeight), 2),
                0.5);
            return [vx/(50+vLength), vy/(50+vLength) ];
        };


        /* Matrices.

         */

        // Frobenius norm of a matrix, i.e. the length of the 4 entries as a
        // vector. Used for comparing matrices across systems without caring
        // about the overall scaling of the vector field.
        this.matrixNorm = function([a11, a21, a12, a22]) {
            return Math.sqrt(a11*a11 + a21*a21 + a12*a12 + a22*a22);
        };

        // Jacobi matrix is found by numerical differentiation
        this.jacobiMat = function(f) {
            const relStep = 1e-4;                          // of a pixel
            const roundoff = Math.sqrt(Number.EPSILON);    // ≈ 1.5e-8
            function Df(u) {
                // A step proportional to a pixel keeps the truncation error a
                // fixed fraction of what we can draw. The floor keeps the
                // difference from being swamped by roundoff when the window is
                // small: central differences carry an error of order ε/h, and
                // the search is asked for a finer answer precisely when zoomed
                // in, so the step cannot be allowed to follow the zoom down
                // without limit.
                let hx = Math.max(relStep*pixWidth, roundoff*(Math.abs(u[0]) + 1));
                let hy = Math.max(relStep*pixHeight, roundoff*(Math.abs(u[1]) + 1));
                let v1 = f(mat22.vectorAdd(u, [hx, 0]));
                let v2 = f(mat22.vectorSub(u, [hx, 0]));
                let r1 = mat22.scalarMul(0.5/hx,
                    mat22.vectorSub(v1, v2));
                let w1 = f(mat22.vectorAdd(u, [0, hy]));
                let w2 = f(mat22.vectorSub(u, [0, hy]));
                let r2 = mat22.scalarMul(0.5/hy,
                    mat22.vectorSub(w1, w2));
                return r1.concat(r2);
            }
            return Df;
        };

        this.solveMatVecEq = function(A, [y1, y2]) {
            // Solve Ax = y by elimination, pivoting on the largest element in
            // the first column.
            //
            // Returns null when A is singular to working precision. The caller
            // then takes a damped step (leastSquaresStep) instead of receiving
            // Infinity or NaN, which is what used to happen: a zero pivot made
            // the whole result NaN and the search gave up without a word.
            let [a11, a21, a12, a22] = A;
            let scale = Math.max(Math.abs(a11), Math.abs(a21),
                                 Math.abs(a12), Math.abs(a22));
            if (scale === 0) { return null; }
            let tolPivot = 1e-12 * scale;

            if (Math.abs(a11) >= Math.abs(a21)) {
                // largest element is in first row
                if (Math.abs(a11) <= tolPivot) { return null; }
                let r1 = a22 - a21/a11*a12;
                if (Math.abs(r1) <= tolPivot) { return null; }
                let yy2 = y2 - a21/a11*y1;
                let x2 = yy2/r1;
                let x1 = (y1 - a12*x2) / a11;
                return [x1, x2];
            };

            // largest element is in second row 
            if (Math.abs(a21) <= tolPivot) { return null; }
            let r1 = a12 - a11/a21*a22;
            if (Math.abs(r1) <= tolPivot) { return null; }
            let yy1 = y1 - a11/a21*y2;
            let x2 = yy1/r1;
            let x1 = (y2 - a22*x2)/ a21;
            return [x1, x2];
        };

        this.leastSquaresStep = function(A, [y1, y2]) {
            // The damped least squares step: the x minimising
            //     ‖A x − y‖² + μ‖x‖²,     μ = 1e-8·(largest entry of A)²
            // from the normal equations (AᵀA + μI)x = Aᵀy.
            //
            // This is the fallback when A is singular. For a singular but
            // consistent system — the line of equilibria of x'=0, y'=-y — it
            // reproduces the solution Newton would have found, and for a
            // singular inconsistent one it at least gives a bounded direction
            // instead of a division by zero.
            let [a11, a21, a12, a22] = A;
            let scale = Math.max(Math.abs(a11), Math.abs(a21),
                                 Math.abs(a12), Math.abs(a22));
            if (scale === 0) { return [0, 0]; } // A = 0: no direction to step in

            let mu = 1e-8 * scale * scale;
            // A is given in column major order, so the rows are (a11,a12) and
            // (a21,a22).
            let b11 = a11*a11 + a21*a21 + mu;
            let b12 = a11*a12 + a21*a22;
            let b22 = a12*a12 + a22*a22 + mu;
            let c1 = a11*y1 + a21*y2;
            let c2 = a12*y1 + a22*y2;
            let det = b11*b22 - b12*b12; // ≥ μ², so never zero

            return [(b22*c1 - b12*c2)/det, (b11*c2 - b12*c1)/det];
        };

        this.newtonSolve = function(f, Df, v0, tol, giveup, residualTol) {
            // Solve f(x) = 0, with starting guess v0
            // Df is the Jacobi matrix of f
            // tol is the largest correction we accept as "done", measured in
            //   the units of v0. The default is a tenth of a pixel.
            // giveup(v) should be true if algorithm should give up
            // residualTol is how small f itself must get. If it is not given
            //   we ask for a large relative improvement on the residual at v0.
            //
            // Success needs two things: the correction is below tol, and the
            // residual is small. Both matter. A singular Jacobian makes the
            // correction zero without getting anywhere, and a field that is
            // merely small would pass a residual test on its own. The default
            // residual test is a ratio on purpose: scaling the whole vector
            // field by a constant leaves the equilibria where they were and
            // must not change the answer, whereas an absolute threshold let a
            // system multiplied by 1e-9 report every clicked point as an
            // equilibrium. A caller whose residual is itself a distance — the
            // cycle search — passes an absolute tolerance instead.
            if (tol === undefined) { tol = equilibriumTolPx*pixWidth; }
            if (giveup === undefined) { giveup = v => false; }
            const maxIt = 100;

            let startResidual = mat22.vectorNorm(f(v0));
            if (residualTol === undefined) {
                residualTol = 1e-6*startResidual;
            }
            let guess = v0;
            let it = 0;
            while (it < maxIt) {
                it++;

                let value = f(guess);
                let step = mat22.solveMatVecEq(Df(guess), value);
                if (step === null) {
                    // Singular Jacobian: no Newton step exists.
                    step = mat22.leastSquaresStep(Df(guess), value);
                }
                let newguess = mat22.vectorSub(guess, step);

                // we give up on NaN or inf
                if (!Number.isFinite(newguess[0]) 
                    || !Number.isFinite(newguess[1])) {
                    return null;
                }
                // We also give on if asked to:
                if (giveup(newguess)) {
                    return null;
                }

                // Have we found a zero ?
                if (mat22.vectorNorm(mat22.vectorSub(guess, newguess)) <= tol
                   && mat22.vectorNorm(value) <= residualTol) {
                    return newguess;
                }

                guess = newguess;
            }

            if (mat22.vectorNorm(f(guess)) <= residualTol) {
                return guess;
            }

            // We haven't found a suitable solution in maxIt iterations
            // and give up:
            return null;
        };

        function eigenVec([a11, a21, a12, a22], lam) {
            // find eigenvector corresponding to eigenval lam
            // Assumes lam is an eigenvalue
            // Both diagonal entries carry the shift. Missing it on a22 leaves
            // the second row independent of lam, so when the second row was the
            // one used, both eigenvalues produced the same direction.
            let [b11, b21, b12, b22] = [a11-lam, a21, a12, a22-lam];
            
            // The rows are proportional, so either one determines the
            // eigenvector. Use the row with the bigger entries: rounding
            // matters more when the row is small. Comparing rows entry by
            // entry is wrong — (-1, 0) is not "smaller than" (0, -2) — so
            // compare their lengths.
            let r1 = b11*b11 + b12*b12;
            let r2 = b21*b21 + b22*b22;
            let v;
            if (r1 >= r2) {
                v = [-b12, b11];
            } else {
                v = [-b22, b21];
            }

            let norm = mat22.vectorNorm(v); 
            if (norm <= 1e-12) { // geometric multiplicity 2
                return [1, 0];
            }
            return mat22.scalarMul(1/norm, v);
        }

        this.classifyEquilibrium = function(Dfx0) {
            // Classify equilibrium.
            // We assume that Dfx0 is the Jacobian at the equilibrium. 
            let equiInfo = {};
            let [Dfx011, Dfx021, Dfx012, Dfx022] = Dfx0;
            let Delta = Dfx011 * Dfx022 - Dfx021 * Dfx012;
            let tau = Dfx011 + Dfx022; 
            let Discr = tau*tau-4*Delta;
            const tol = 1e-5; // for determining numerically equal to zero

            // The thresholds below are compared against the entries of the
            // Jacobian scaled to largest entry 1. Without that, the same
            // system multiplied by a constant would be classified differently:
            // Delta carries two factors of the scaling and tau one, while tol
            // is a hard number. The original scale is kept for the eigenvalues
            // themselves.
            let scale = Math.max(Math.abs(Dfx011), Math.abs(Dfx021),
                                 Math.abs(Dfx012), Math.abs(Dfx022));
            let s = (scale > 0) ? 1/scale : 1;
            let DeltaN = Delta * s * s;
            let tauN = tau * s;
            let DiscrN = Discr * s * s;

            // Determine stability
            if (DeltaN > tol && tauN < -tol) {
                equiInfo.stability = "stable";
            } else if (DeltaN < -tol || tauN > tol) {
                equiInfo.stability = "unstable";
            } else {
                equiInfo.stability = "unknown";
            }

            if ( Math.abs(DeltaN) <= tol ) {
                if (Math.abs(tauN) <= tol ) {
                    equiInfo.type = "NonHyperbolic";
                    return equiInfo;
                }
                equiInfo.type = "SaddleNode";
                // One non-zero equivalue
                equiInfo.lam = tau;
                equiInfo.eigenvec = eigenVec(Dfx0, tau);
                return equiInfo;
            }

            if (DeltaN < 0) {
                // Saddle
                equiInfo.type = "Saddle";
                let lam1 = 0.5*(tau-Math.sqrt(Discr));
                let lam2 = 0.5*(tau+Math.sqrt(Discr));
                equiInfo.stableDir = eigenVec(Dfx0, lam1);
                equiInfo.unstableDir = eigenVec(Dfx0, lam2);
                return equiInfo;
            }

            if (DiscrN < -tol ) {
                if (Math.abs(tauN) > tol) {
                // Focus
                    equiInfo.type = "Focus";
                    return equiInfo;
                }
                // Focus or center
                equiInfo.type = "FocusOrCenter";
                return equiInfo;
            }

            // Last possibility is a node, which might be improper.
            equiInfo.type = "Node";
            return equiInfo;
        };

    };


    /* 
     * For changing between pixels coordinates (i,j) and coordinates
     * for the region in the plane.
     */
    function pix2xy(i, j) {
            let x = i/(width-1)*(xmax - xmin) + xmin;
            let y = j/(height-1)*(ymin -ymax) + ymax;
            return [x, y];
    };

    function xy2pix(x, y) {
        let i = (x - xmin) / (xmax - xmin) * (width-1);
        let j = (ymax - y) / (ymax - ymin) * (height-1);
        return [i, j];
    };


    let drawTools={ // name space for drawing tools
        "circle_xy": function(vec_xy, rad) {
            let vec_ij = xy2pix( vec_xy[0], vec_xy[1] );
            portrait.beginPath();
            portrait.arc(vec_ij[0], vec_ij[1], rad, 0, 2*Math.PI, false);
            portrait.fill();
            portrait.stroke();
        },

        // An unfilled circle, for marking something that is not a point.
        "ring_xy": function(vec_xy, rad) {
            let vec_ij = xy2pix( vec_xy[0], vec_xy[1] );
            portrait.beginPath();
            portrait.arc(vec_ij[0], vec_ij[1], rad, 0, 2*Math.PI, false);
            portrait.stroke();
        },

        // A filled triangular head with its tip at `tip_ij`, pointing away
        // from `back_ij`. Both are pixel coordinates, `size` is the length
        // of the head in pixels.
        "arrowHead_ij": function(tip_ij, back_ij, size) {
            if (!(size >= arrowHeadMinPx)) { return; }
            let dx = tip_ij[0] - back_ij[0];
            let dy = tip_ij[1] - back_ij[1];
            let len = Math.hypot(dx, dy);
            if (!(len > 1e-9)) { return; }
            let ux = dx/len;   // unit tangent, pointing forward
            let uy = dy/len;
            let nx = -uy;      // unit normal
            let ny = ux;
            let halfWidth = size * arrowHeadWidthRatio;
            let baseX = tip_ij[0] - size*ux;
            let baseY = tip_ij[1] - size*uy;
            portrait.beginPath();
            portrait.moveTo(tip_ij[0], tip_ij[1]);
            portrait.lineTo(baseX + halfWidth*nx, baseY + halfWidth*ny);
            portrait.lineTo(baseX - halfWidth*nx, baseY - halfWidth*ny);
            portrait.closePath();
            portrait.fill();
        },

        "moveTo_xy": function( vec_xy ) {
            let vec_ij = xy2pix( vec_xy[0], vec_xy[1] );
            portrait.moveTo(vec_ij[0], vec_ij[1]);
        },

        "lineTo_xy": function( vec_xy ) {
            let vec_ij = xy2pix( vec_xy[0], vec_xy[1] );
            portrait.lineTo(vec_ij[0], vec_ij[1]);
        },

        // Heun's Method
        // (an order 2 Runge Kutta method).
        "HeunStep": function(pos, dt) {
            let v = fModerated(pos);
            let pos1 = mat22.vectorAdd(
                    pos,
                    mat22.scalarMul(dt, v));
            let w = mat22.scalarMul(0.5, mat22.vectorAdd(fModerated(pos1), v));
            return mat22.vectorAdd(pos, mat22.scalarMul(dt, w));
        },

        // Runge Kutta's method of order 4
        "RK4Step": function(pos, dt) {
            let k1 = fModerated(pos);

            let pos_k2 = mat22.vectorAdd(
                pos, 
                mat22.scalarMul(dt * 0.5, k1)
            );
            let k2 = fModerated(pos_k2);

            let pos_k3 = mat22.vectorAdd(
                pos, 
                mat22.scalarMul(dt * 0.5, k2)
            );
            let k3 = fModerated(pos_k3);

            let pos_k4 = mat22.vectorAdd(
                pos, 
                mat22.scalarMul(dt, k3)
            );
            let k4 = fModerated(pos_k4);

            // "Effective" vector field w = (k1 + 2*k2 + 2*k3 + k4) / 6
            let k2_plus_k3 = mat22.vectorAdd(k2, k3);
            let middle_terms = mat22.scalarMul(2.0, k2_plus_k3); // 2*k2 + 2*k3
            
            let total_sum = mat22.vectorAdd(k1, mat22.vectorAdd(middle_terms, k4)); // k1 + (2*k2 + 2*k3) + k4
            let w = mat22.scalarMul(1.0 / 6.0, total_sum);

            // Here we take the step 
            return mat22.vectorAdd(pos, mat22.scalarMul(dt, w));
        },


        // `pathOut` is optional. When an array is passed, the polyline is
        // pushed into it, so the caller can inspect the direction of travel.
        // The return value stays the end position: several callers integrate
        // a single step and use the result as the next starting point.
        "integrate": function(startPos, nSteps, deltaTime, draw=true, pathOut=null) {
            let pos = startPos;
            if (pathOut) {
                pathOut.push(pos);
            }
            portrait.beginPath();

            if (draw) {
                drawTools.moveTo_xy( pos );
            }
            
            for (let k = 0; k < nSteps; k++) {
                let v = fModerated(pos);
                pos = this.RK4Step(pos, deltaTime);
                if (pathOut) {
                    pathOut.push(pos);
                }
                if (draw) {
                    drawTools.lineTo_xy( pos );
                }
            }
            if (draw) {
                portrait.stroke();
            }
            return pos;
        }
    }; // Thus ends defintion of drawing tools




    // event handler: draw an orbit or find fixed point or cycle

    function actOnClick(e) {
        if (!expressionOkay) { return; }

        if (e.shiftKey) {
            searchEquilibrium(e);
            return;
        }
        if (e.ctrlKey) {
            searchCycle(e);
            return;
        }
        integrateOnClick(e);
    }

    /* Fixed point search.

     equilibriumTolPx is the search tolerance measured in pixels. The search is
     done when the next correction is smaller than this, which ties the accuracy
     to the picture: zooming in tightens the demand.

     There is deliberately no separate threshold for "is this eigenvalue zero".
     Such a threshold would have to be a judgement call, and both answers were
     wrong in practice: x = y² has a curve of equilibria whose field grows like
     h² along its own tangent, exactly as the degenerate isolated zero of
     x'=x², y'=y does along its direction of weakness. No number separates
     them. What does is looking for a second zero (see zeroSetKind).
     */
    const equilibriumTolPx = 0.1;

    // The position is only worth as many digits as the tolerance supports.
    function significantDigits() {
        let d = Math.ceil(Math.log10((xmax - xmin)/(equilibriumTolPx*pixWidth)));
        return Math.max(2, Math.min(6, d));
    }

    // A direction that the (singular) Jacobian maps to zero, found as the
    // perpendicular of its longer row. Returns null when the whole Jacobian
    // vanishes, in which case there is no distinguished direction.
    function nullDirection(Df) {
        let [a11, a21, a12, a22] = Df;
        let row1 = [a11, a12];
        let row2 = [a21, a22];
        let row = (mat22.vectorNorm(row1) >= mat22.vectorNorm(row2)) ? row1 : row2;
        let v = [-row[1], row[0]];
        let n = mat22.vectorNorm(v);
        if (n === 0) { return null; }
        return mat22.scalarMul(1/n, v);
    }

    /* Is the zero set near p a point, a curve, or a region?

     A point of the zero set tells us nothing about its neighbours on its own.
     For x'=0, y'=0 every point of the plane is an equilibrium, and for
     x'=0, y'=-y the equilibria fill the line y=0; in both cases reporting a
     single point with five digits is worse than saying what is going on.

     The test samples the field two pixels out. Along a direction where it
     stays put, equilibria continue; that is decided relative to the largest
     change the Jacobian could produce over the same distance, which makes the
     test independent of the scaling of the field.
     */
    function zeroSetKind(p, Df, DfFn) {
        const h = 2*pixWidth;
        const probe = function(d) {
            return Math.max(
                mat22.vectorNorm(f(mat22.vectorAdd(p, mat22.scalarMul(h, d)))),
                mat22.vectorNorm(f(mat22.vectorSub(p, mat22.scalarMul(h, d))))
            );
        };

        let v = nullDirection(Df);
        if (v === null) {
            // The Jacobian vanishes at p. The field is stationary there, and
            // it either vanishes over a neighbourhood or p is a degenerate
            // isolated zero. Look further out than a couple of pixels: a zero
            // of order two is invisible at that distance.
            const r = 0.05*(xmax - xmin);
            const diag = 1/Math.SQRT2;
            const dirs = [[1, 0], [0, 1], [diag, diag], [diag, -diag]];
            let vanishing = 0;
            for (let i = 0; i < dirs.length; i++) {
                if (Math.max(
                    mat22.vectorNorm(f(mat22.vectorAdd(p, mat22.scalarMul(r, dirs[i])))),
                    mat22.vectorNorm(f(mat22.vectorSub(p, mat22.scalarMul(r, dirs[i]))))
                ) === 0) {
                    vanishing++;
                }
            }
            if (vanishing === dirs.length) {
                return { kind: "region" };
            }
            return { kind: "point", nonLinear: true };
        }

        let across = [-v[1], v[0]];
        // How large a change a generic direction would show over the probe
        // distance. Zero only when the Jacobian is zero, which is handled
        // above.
        let ref = mat22.matrixNorm(Df)*h;

        let alongAcross = probe(across);

        // If the field changes far more across a couple of pixels than the
        // Jacobian can account for, the linearisation describes almost none of
        // what is going on here and the classification built on it is worth
        // little. That is the case at a zero of order two, where the
        // Jacobian vanishes while the field does not.
        let nonLinear = alongAcross > 100*ref;

        // Does the zero set continue? Probing along the null direction is not
        // enough to answer that. A curve that bends, such as x = y², has a
        // field growing like h² along its own tangent, and a degenerate
        // isolated zero such as x'=x², y'=y does exactly the same along its
        // direction of weakness: the two are indistinguishable along one ray.
        //
        // What separates them is whether there is another zero out there. So
        // step a few pixels along the presumed direction and search from
        // there. On a curve that lands on a different point of it; at an
        // isolated zero the search comes back to p.
        const reach = 3*pixWidth;
        let there = mat22.newtonSolve(f, DfFn,
            mat22.vectorAdd(p, mat22.scalarMul(reach, v)));
        if (there !== null) {
            let chord = mat22.vectorSub(there, p);
            if (mat22.dot(chord, v) > 0.5*reach) {
                let n = mat22.vectorNorm(chord);
                return { kind: "curve", dir: mat22.scalarMul(1/n, chord) };
            }
        }

        return { kind: "point", nonLinear: nonLinear };
    }

    /* Following the zero set.

     A straight segment along the tangent is a poor picture of a curve of
     equilibria. The parabola x = y² turns sharply near its vertex, and a
     30 pixel chord leaves the curve by several pixels at each end — so
     clicking up through a bend draws segments that cross each other.

     Instead, walk the zero set: step along the tangent, then pull the point
     back onto the zero set with Newton. On a curve that lands a little
     further along it, and the next step uses the direction actually walked,
     not the tangent at the start.

     The walk stops as soon as the search comes back to where it started, or
     barely moves, which is what happens past the end of the zero set.
     */
    function traceZeroCurve(start, dir, pixLen, DfFn) {
        const stepPx = 2;
        const step = stepPx*pixWidth;
        const n = Math.max(1, Math.round(pixLen/stepPx));
        let pts = [];
        let p = start;
        let d = dir;
        for (let k = 0; k < n; k++) {
            let q = mat22.newtonSolve(f, DfFn,
                mat22.vectorAdd(p, mat22.scalarMul(step, d)));
            if (q === null) { break; }
            let chord = mat22.vectorSub(q, p);
            let len = mat22.vectorNorm(chord);
            if (!(len > 0.5*step)) { break; }        // no curve out there
            if (!(mat22.dot(chord, d) > 0)) { break; } // went backwards
            d = mat22.scalarMul(1/len, chord);
            p = q;
            pts.push(p);
        }
        return pts;
    }

    function searchEquilibrium(e) {
        // Search and classify equilibrium
        // First search
        let bound = portraitElem.getBoundingClientRect();
        let pos = pix2xy( e.clientX -bound.left - xOffset,
            e.clientY - bound.top - yOffset);
        let Df = mat22.jacobiMat(f);
        let equi = mat22.newtonSolve(f, Df, pos);

        if (equi === null) {
            // No word from the search is not the same as no answer. Say so.
            logTxt("\nNo isolated equilibrium found near the click."
                + " The field may vanish along a curve or over a region,"
                + " or the search may have wandered away from the window.");
            return;
        }

        // A second pass at a much tighter tolerance. The classification reads
        // the Jacobian at the point, and whether an eigenvalue is zero or just
        // small is decided by how close to the equilibrium we got: at a saddle
        // node the linear part only looks degenerate within a hair of the
        // point itself. If the refinement does not succeed we keep the first
        // answer, which is already within tolerance.
        let refined = mat22.newtonSolve(f, Df, equi,
            1e-3*equilibriumTolPx*pixWidth);
        if (refined !== null) { equi = refined; }

        let DfAtEqui = Df(equi);
        let zeroSet = zeroSetKind(equi, DfAtEqui, Df);

        if (zeroSet.kind === "region") {
            logTxt("\nThe field appears to vanish over a whole neighbourhood of"
                + " this point. Every point here is an equilibrium, so there is"
                + " no isolated point to report.");
            portrait.strokeStyle = Wong.black;
            portrait.lineWidth = 1.5;
            drawTools.ring_xy(equi, 6);
            return;
        }

        if (zeroSet.kind === "curve") {
            logTxt("\nThe field appears to vanish along a curve through this"
                + " point. The equilibria are not isolated.");
            let info = mat22.classifyEquilibrium(DfAtEqui);
            if (info.type === "SaddleNode" && info.lam !== 0) {
                // One eigenvalue is zero: the other one decides what happens
                // to orbits that are not on the curve.
                logTxt(info.lam < 0
                    ? "Nearby orbits approach the curve."
                    : "Nearby orbits move away from the curve.");
            }
            // Draw the curve by following it, not by drawing its tangent.
            let back = traceZeroCurve(equi,
                [-zeroSet.dir[0], -zeroSet.dir[1]], 30, Df);
            let fwd = traceZeroCurve(equi, zeroSet.dir, 30, Df);
            let line = back.slice().reverse().concat([equi], fwd);
            portrait.strokeStyle = Wong.black;
            portrait.lineWidth = 2;
            portrait.beginPath();
            drawTools.moveTo_xy(line.length > 0 ? line[0] : equi);
            for (let k = 0; k < line.length; k++) {
                drawTools.lineTo_xy(line[k]);
            }
            portrait.stroke();
            portrait.lineWidth = 1;
            return;
        }

        // The zero set is a single point here, so classify it
        let equiInfo = mat22.classifyEquilibrium(DfAtEqui);

        logTxt("\nFound equilibrium point at " 
            + "(" + equi[0].toPrecision(significantDigits()).toString()
            + ", "
            + equi[1].toPrecision(significantDigits()).toString() + ").");

        switch (equiInfo.type) {
            case "Saddle":
                logTxt("It's a saddle.")
                portrait.strokeStyle=Wong.bluishGreen;
                portrait.fillStyle=Wong.bluishGreen;
                drawTools.circle_xy( equi, 2 );

                portrait.lineWidth=1.5;

                // Stable manifold
                let displacement =  mat22.scalarMul(0.1*pixWidth, equiInfo.stableDir);
                drawTools.integrate(
                    mat22.vectorAdd(equi, displacement)
                    , 10*width
                    , -1
                );
                drawTools.integrate(
                    mat22.vectorSub(equi, displacement)
                    , 10*width
                    , -1
                );

                // unstable manifold
                displacement =  mat22.scalarMul(0.5*pixWidth, equiInfo.unstableDir);

                drawTools.integrate(
                    mat22.vectorAdd(equi, displacement)
                    , 10*width
                    , 1
                );
                drawTools.integrate(
                    mat22.vectorSub(equi, displacement)
                    , 10*width
                    , 1
                );

                portrait.lineWidth=1;

                break;

            case "SaddleNode":
                logTxt("It's (close to) non-hyperbolic, with 1D center manifold.")

                portrait.strokeStyle = Wong.bluishGreen;
                portrait.fillStyle = Wong.bluishGreen;
                portrait.lineWidth=1.5;

                // We draw the stable or unstable manifold
                // (and ignore the center one)
                let sign = (equiInfo.lam < 0) ? -1 : 1;
                let displ =  mat22.scalarMul(0.1*pixWidth, equiInfo.eigenvec);

                drawTools.integrate(
                    mat22.vectorAdd(equi, displ)
                    , 10*width
                    , sign
                );
                drawTools.integrate(
                    mat22.vectorSub(equi, displ)
                    , 10*width
                    , sign
                );

                portrait.lineWidth=1;
                portrait.strokeStyle = Wong.vermillion;
                portrait.fillStyle = Wong.vermillion;
                drawTools.circle_xy( equi, 3 );

                break;

            case "NonHyperbolic":
                logTxt("It's (close to being) non-hyperbolic.");
                portrait.strokeStyle = Wong.black;
                portrait.fillStyle = Wong.black;
                drawTools.circle_xy( equi, 4 );
                portrait.strokeStyle = Wong.skyBlue;
                portrait.fillStyle = Wong.skyBlue;
                drawTools.circle_xy( equi, 2 );

                break;

            case "Focus":
                if (equiInfo.stability === "stable") {
                    logTxt("It's a stable focus.");
                } else {
                    logTxt("It's an unstable focus.");
                }
                portrait.strokeStyle = Wong.reddishPurple;
                portrait.fillStyle= Wong.reddishPurple;
                drawTools.circle_xy( equi, 3 );

                break;

            case "FocusOrCenter":
                logTxt("It's a focus or center.");
                portrait.strokeStyle = Wong.reddishPurple;
                portrait.fillStyle= Wong.reddishPurple;
                drawTools.circle_xy( equi, 3 );

                break;

            default: // Node
                if (equiInfo.stability === "stable") {
                    logTxt("It's a stable node.");
                } else {
                    logTxt("It's an unstable node.");

                }
                portrait.strokeStyle=Wong.black;
                portrait.fillStyle=Wong.black;
                drawTools.circle_xy( equi, 3 );
        }

        if (zeroSet.nonLinear && equiInfo.type !== "NonHyperbolic") {
            logTxt("Careful: across one pixel the field changes far more than"
                + " this linearisation accounts for, so the label above says"
                + " little about what happens at the size of the picture.");
        }

    }

    function searchCycle(e) {
        // We look for a close return 
        // initial position
        let bound = portraitElem.getBoundingClientRect();
        let startPos = pix2xy( e.clientX -bound.left - xOffset,
            e.clientY - bound.top - yOffset);
        let pos = startPos; 
        let t = 0.0;
        let maxT = 10 * width;
        let diam = 0;
        let dist = 0;
        let canSearch = false;
        let direction = 1; // we look forward in time

        // First we look forward
        while (t < maxT) {
            pos = drawTools.integrate(pos, 1, 1, false);
            t = t + 1.0;
            dist = mat22.vectorNorm(mat22.vectorSub(pos, startPos));
            if (dist > diam) {
                diam = dist;
            }

            // If we are close and not getting closer:
            if (dist < 0.3 * diam &&
                mat22.dot(fModerated(pos),
                          mat22.vectorSub(startPos, pos)) < 0) {
                canSearch = true;
                break;
            }
        }
        if (!canSearch) {
            // didn't work, we look back
            t = 0;
            pos = startPos;
            diam = 0;
            direction = -1;

            while (-t < maxT) {
                pos = drawTools.integrate(pos, 1, -1, false);
                t = t - 1.0;
                dist = mat22.vectorNorm(mat22.vectorSub(pos, startPos));
                if (dist > diam) {
                    diam = dist;
                }

                // If we are close and not getting closer:
                if (dist < 0.3 * diam &&
                    mat22.dot(fModerated(pos),
                              mat22.vectorSub(startPos, pos)) > 0) {
                    canSearch = true;
                    break;
                }
            }
        }

        if (!canSearch) {
            return
        }


        // To search for cycle we introduce new coordinates: timespace
        // (x,y) = phi_timespace[0](startPos + fHatStartPos * timespace[1]))
        let fStartPos = fModerated(startPos);
        let fHatStartPos = [-fStartPos[1], fStartPos[0]];

        function displace(u) {
            return mat22.vectorAdd(startPos, mat22.scalarMul(u,fHatStartPos));
        }

        function flow(pos, time, maxDeltaT) {
            nSteps = Math.ceil(Math.abs(time / maxDeltaT));
            deltaT = time / nSteps;
            return drawTools.integrate(pos, nSteps, deltaT, false);
        }

        function h(timeSpace) {
            let pos1 = displace(timeSpace[1]);
            let pos2 = flow(pos1, timeSpace[0], 1.0);
            return mat22.vectorSub(pos2, pos1);
        }

        function Dh(timeSpace) {
            let pos1 = displace(timeSpace[1]);
            let pos2 = flow(pos1, timeSpace[0], 1.0);
            let dPosdTime = fModerated(pos2);

            let eps = 1e-5 * pixWidth;
            let pos1a = displace(timeSpace[1]+eps);
            let pos2a = flow(pos1a, timeSpace[0], 1.0);
            let pos1b = displace(timeSpace[1]-eps);
            let pos2b = flow(pos1a, timeSpace[0], 1.0);

            let dPosdPos = mat22.scalarMul(0.5/eps,
                mat22.vectorSub( 
                    mat22.vectorSub(pos2a, pos2b),
                    mat22.vectorSub(pos1a, pos1b)
                )
            );
            return dPosdTime.concat(dPosdPos);
        }

        function giveup(v) {
            return (Math.abs(v[0]) > 6*width);
        }

        // The residual of h is a distance, so an absolute tolerance is right
        // here; the equilibrium search, whose residual is a field value,
        // passes nothing and gets the scale-free default.
        cycle = mat22.newtonSolve(h, Dh, [t, 0], pixWidth*1e-2, giveup,
            pixWidth*1e-2);
        if (!cycle) return; 

        // If the diameter of the cycle is too short, we probably just found
        // a center.
        cycle.pos = displace(cycle[1]);
        cycle.period = cycle[0];
        pos = cycle.pos;
        diam = 0;
        t = 0.0;
        while (Math.abs(t) < Math.abs(cycle.period)) {
            t = t+1.0;
            pos = drawTools.integrate(pos, 1, direction, false);
            dist = mat22.vectorNorm(mat22.vectorSub(pos, cycle.pos));
            if (dist > diam) {
                diam = dist;
            }
        }
        if (diam <= 5*pixWidth) return;

        // The diameter is not too small.
        // We probably found a cycle!
        portrait.lineWidth=3;
        portrait.fillStyle = Wong.reddishPurple;
        portrait.strokeStyle = Wong.reddishPurple; 

        drawTools.integrate(cycle.pos, Math.abs(cycle.period), direction);
        portrait.lineWidth=1;

        logTxt("\nIt seems there's a cycle going through "
                + "(" + cycle.pos[0].toPrecision(5).toString()
                + ", "
                + cycle.pos[1].toPrecision(5).toString() + ").");
    } 

    function integrateOnClick(e) {
        let borderX=1;
        let borderY=1;
        portrait.strokeStyle = Wong.blue;
        let bound = portraitElem.getBoundingClientRect();
        let pos = pix2xy( e.clientX -bound.left - borderX - xOffset,
            e.clientY - bound.top - borderY - yOffset);
        drawTools.integrate(pos, 5*width, 1);
        drawTools.integrate(pos, 5*width, -1);
    }



    /* Words that cannot be used as parameter names.
     *
     * Three groups, three different reasons:
     *  - JavaScript keywords and built-ins: `let class = 1` is a syntax error.
     *  - Identifiers the generated function uses itself: a parameter named `fx`
     *    would clash with the `let fx = ...` line.
     *  - Names the lexer tokenises before it looks for variables: "pi" becomes
     *    a number and "sin", "cos", "tan", "exp", "log" become functions, so a
     *    parameter with one of those names could be declared but never used.
     */
    const RESERVED_NAMES = new Set([
        "let", "const", "var", "function", "return", "new", "class", "this",
        "if", "else", "for", "while", "do", "switch", "case", "default",
        "break", "continue", "try", "catch", "finally", "throw", "typeof",
        "instanceof", "in", "of", "delete", "void", "yield", "await", "super",
        "extends", "import", "export", "with", "debugger", "null", "true",
        "false", "undefined", "arguments", "eval", "NaN", "Infinity", "Math",
        "fx", "fy",
        "pi", "sin", "cos", "tan", "exp", "log"
    ]);

    /* Names in an expression that are not available where it is evaluated.
     * These are reported by name, so that "b is used before it is declared"
     * does not disguise itself as "cannot evaluate the vector field".
     */
    function unboundNames( expr, allowed ) {
        return [...expr.varNames()].filter( function( name ) {
            return !allowed.has( name );
        });
    }

    function initDynSys(xVarTxt, yVarTxt, params, fExprTxt, gExprTxt) {
        expressionOkay = false;

        if (!Array.isArray(params) || params.length === 0) {
            throw "At least one parameter is required.";
        }
        if (xVarTxt == yVarTxt) {
            throw "The two dynamical variables must have different names!";
        }

        /* The names available to an expression at each step. Slot i may use x,
         * y, and the parameters declared before it. The order of the rows is
         * therefore the order of evaluation, and a cycle is impossible without
         * needing a dependency analysis.
         */
        let allowed = new Set([xVarTxt, yVarTxt]);
        let declarations = [];

        for (let i = 0; i < params.length; i++) {
            let name = String(params[i].name);
            let exprTxt = String(params[i].expr);

            if (name == xVarTxt || name == yVarTxt) {
                throw "The parameter must not be called the same as a variable: '"
                    + name + "'";
            }
            if (!name.match(/^[a-zA-Z][a-zA-Z0-9]*$/)) {
                throw "A parameter name is not legal: '" + name + "'";
            }
            if (RESERVED_NAMES.has(name)) {
                throw "The name '" + name + "' is reserved and cannot be "
                    + "used as a parameter.";
            }
            if (allowed.has(name)) {
                throw "The parameter name '" + name + "' is used twice.";
            }

            let expr = lexAndParse(exprTxt);
            let unbound = unboundNames(expr, allowed);
            if (unbound.length > 0) {
                throw "The value of '" + name + "' uses "
                    + (unbound.length === 1 ? "a name that is" : "names that are")
                    + " not defined before it: " + unbound.join(", ")
                    + ". Parameters are evaluated from the first row down.";
            }
            declarations.push("let " + name + " = " + expr + ";");
            allowed.add(name);
        }

        let fExpr = lexAndParse(fExprTxt);
        let gExpr = lexAndParse(gExprTxt);

        let unboundF = unboundNames(fExpr, allowed);
        if (unboundF.length > 0) {
            throw "There " + (unboundF.length === 1 ? "is an unbound variable" : "are unbound variables")
                + " in the equation for " + xVarTxt + ": " + unboundF.join(", ");
        }
        let unboundG = unboundNames(gExpr, allowed);
        if (unboundG.length > 0) {
            throw "There " + (unboundG.length === 1 ? "is an unbound variable" : "are unbound variables")
                + " in the equation for " + yVarTxt + ": " + unboundG.join(", ");
        }

        /* Here's the slow way, kept as a reference in case building source
         * becomes a problem:
         *   f = function( [px, py] ) {
         *       let store = new Map([[xVarTxt, px], [yVarTxt, py]]);
         *       for each parameter, in order: store.set(name, expr.eval(store));
         *       return [fExpr.eval(store), gExpr.eval(store)];
         *   };
         * The row order is what makes that loop correct as well.
         */

        // We "compile" the expression into a JavaScript function.
        // The declarations are emitted in row order, so a parameter may use the
        // ones above it. Anything that still fails here is something the checks
        // above did not anticipate (a reserved word, say), and it is reported as
        // such rather than as a mysterious failure to evaluate.
        let source = "return function([" + xVarTxt + ", " + yVarTxt + "]) {\n"
            + declarations.map(function(d) { return "    " + d; }).join("\n") + "\n"
            + "    let fx = " + fExpr + ";\n"
            + "    let fy = " + gExpr + ";\n"
            + "    return [fx, fy];\n"
            + "}";
        let compiled;
        try {
            compiled = new Function(source)();
        }
        catch (err) {
            throw "Could not compile the vector field: " + err.message;
        }
        f = compiled;

        try {
            f([xmin, ymin]);
        }
        catch(err) {
            // didn't work
            throw "Cannot evaluate vector field. Check the expressions";
        }
        // Okay everything seems okay
        expressionOkay = true;

        fModerated = function( p ) {
            return mat22.moderate(f(p));
        };
    }

    /* Draws the title in the top margin, centred over the plot area.
     * Must be called before drawCoords: drawCoords leaves a translate in
     * the context and sets font/textAlign without restoring them.
     * The plot area (not the canvas) is the reference, so that the title
     * stays centred if the margins ever become asymmetric.
     */
    function drawTitle() {
        if (!titleTxt) { return; }
        portrait.save();
        portrait.textAlign = "center";
        portrait.textBaseline = "middle";
        portrait.fillStyle = Wong.black;
        portrait.font = "bold " + titleFontPx + "px Arial";

        // Prefer a smaller font over squashed letters.
        const available = width;
        const measured = portrait.measureText(titleTxt).width;
        if (measured > available && measured > 0) {
            let fontPx = Math.max(titleFontMinPx,
                Math.floor(titleFontPx * available / measured));
            portrait.font = "bold " + fontPx + "px Arial";
        }
        // maxWidth is the guarantee: the title can never leave the plot area.
        portrait.fillText(titleTxt, xOffset + width / 2, yOffset / 2, available);
        portrait.restore();
    }

    /* Draws the axis names in the margins: x centred under the plot, y
     * rotated ninety degrees anticlockwise in the left margin.
     * Called before drawCoords, in absolute canvas coordinates, so that the
     * translate left behind by drawCoords does not apply. save/restore keeps
     * the rotation from leaking into the phase portrait.
     */
    function drawAxisNames() {
        const plotBottom = yOffset + height;
        portrait.save();
        portrait.fillStyle = Wong.black;
        portrait.font = "italic " + axisFontPx + "px Arial";
        portrait.textAlign = "center";
        portrait.textBaseline = "middle";

        // Below the tick labels, which sit 22 px under the plot.
        portrait.fillText(xVarName, xOffset + width / 2, plotBottom + 46, width);

        portrait.translate(axisNameYx, yOffset + height / 2);
        portrait.rotate(-Math.PI / 2);
        portrait.fillText(yVarName, 0, 0, height);

        portrait.restore();
    }

    function drawCoords() {
        function majorStep(min, max) {
            const orderOfMag = Math.pow(10, Math.floor(Math.log10(max-min)));
            const decas = (max - min) / orderOfMag;
            const relStep =
                decas > 6   ? 1.0 :
                decas > 3   ? 0.5 :
                decas > 1.5 ? 0.2 :
                              0.1 ;
            return orderOfMag * relStep;
        }

        function minorTics(min, max) {
            const minorsPerMajor = 5;
            const step = majorStep(min, max) / minorsPerMajor;
            let tics = [];
            let position = min < 0 ? step*Math.ceil(min/step) : step*Math.floor(min/step);
            while (position <= max + 1e-24) {
                tics.push(position);
                position += step;
            }
            return tics;
        }

        function majorTics(min, max) {
            let tics = [];
            const step = majorStep(min, max);
            let necessaryDigits = -Math.ceil(Math.log10(step));
            necessaryDigits = necessaryDigits < 0 ? 1 : 1 + necessaryDigits;
            let position = min < 0 ? step*Math.ceil(min/step) : step*Math.floor(min/step);
            position = parseFloat(position.toFixed(necessaryDigits));
            while (position <= max + 1e-24) {
                tics.push(position);
                position += step;
                position = parseFloat(position.toFixed(necessaryDigits));
            }
            return tics;
        }
        // Draw the coordinate system
        // first we compute the positions
        let xMinorTics = minorTics(xmin, xmax);
        let xMajorTics = majorTics(xmin, xmax);
        let yMinorTics = minorTics(ymin, ymax);
        let yMajorTics = majorTics(ymin, ymax);
        let x, y;

        // We draw labels
        portrait.translate(0, yOffset)

        portrait.font = "12px Arial"; 
        portrait.textAlign = "right"
        for (y of yMajorTics) {
            let pixpos = xy2pix(0, y);
            // if the range is small or big we use exponential notation
            if (ymax - ymin > 1e5 || ymax - ymin < 1e-5) {
                portrait.fillText(y.toExponential(2), xOffset-4, pixpos[1]+4);
            } else {
                portrait.fillText(y, xOffset-4, pixpos[1]+4);
            }
        }

        portrait.translate(xOffset, 0)

        portrait.textAlign = "center"
        for (x of xMajorTics) {
            let pixpos = xy2pix(x, 0);
            // if the range is small or big we use exponential notation
            // exponential notation is decided by the x range, not the y range
            if (xmax - xmin > 1e5 || xmax - xmin < 1e-5) {
                portrait.fillText(x.toExponential(2), pixpos[0], height+4+yOffset/2);
            } else {
                portrait.fillText(x, pixpos[0], height+4+yOffset/2);
            }
        }

    
        // then we draw them
        // minor tics
        portrait.lineWidth=1;
        portrait.strokeStyle = "#fee" // #eef";
        for (x of xMinorTics) {
            portrait.beginPath();
            drawTools.moveTo_xy([x, ymin]);
            drawTools.lineTo_xy([x, ymax]);
            portrait.stroke();
        }
        for (y of yMinorTics) {
            portrait.beginPath();
            drawTools.moveTo_xy([xmin, y]);
            drawTools.lineTo_xy([xmax, y]);
            portrait.stroke();
        }

        // major tics
        portrait.lineWidth=2;
        portrait.strokeStyle = "#fdd"; //"#ddf";
        for (y of yMajorTics) {
            portrait.beginPath();
            drawTools.moveTo_xy([xmin, y]);
            drawTools.lineTo_xy([xmax, y]);
            portrait.stroke();
        }
        for (x of xMajorTics) {
            portrait.beginPath();
            drawTools.moveTo_xy([x, ymin]);
            drawTools.lineTo_xy([x, ymax]);
            portrait.stroke();
        } 

        // Finally we clip to protect the labels
        // We are working in a translated coordinate system
        portrait.rect(0, 0, width, height);
        portrait.clip()

    }

    /*
     * Triangular head at the forward end of an integrated arc.
     *
     * The size comes from the speed measured along the arc itself, in pixels
     * per step. That speed is exactly what `moderate` produces, so the head
     * tapers with the field and disappears where the field vanishes.
     *
     * The direction is taken from the arc, not from the field at the tip.
     * Near an equilibrium the field at the tip is almost zero, so its angle
     * is numerical noise, whereas the arc still points the way it came from.
     */
    function drawArrowHead(path) {
        if (path.length < 2) { return; }
        let end_xy = path[path.length-1];
        let end_ij = xy2pix(end_xy[0], end_xy[1]);

        let arcPx = 0;
        let prev_ij = xy2pix(path[0][0], path[0][1]);
        // Closest point to the tip that is still far enough away to give a
        // stable angle. If even the first point is too close, no head.
        let anchor_ij = null;

        for (let k = 1; k < path.length; k++) {
            let cur_ij = xy2pix(path[k][0], path[k][1]);
            arcPx += Math.hypot(cur_ij[0]-prev_ij[0], cur_ij[1]-prev_ij[1]);
            if (Math.hypot(end_ij[0]-cur_ij[0], end_ij[1]-cur_ij[1])
                    >= arrowHeadAnchorPx) {
                anchor_ij = cur_ij;
            }
            prev_ij = cur_ij;
        }
        if (!anchor_ij) { return; }

        let speedPx = arcPx / (path.length-1);  // pixels travelled per step
        let size = arrowHeadMaxPx * Math.min(1, speedPx);
        drawTools.arrowHead_ij(end_ij, anchor_ij, size);
    }

    function initialDrawing() {
        // Draw vector
        // Colors
        portrait.strokeStyle = Wong.vermillion;
        portrait.fillStyle = Wong.vermillion;
        portrait.lineWidth = 1;
        // Draw vectors on a grid
        let iStep = width / (initialGridPtsX+1) 
        let jStep = height / (initialGridPtsY+1) 
        let nSteps = Math.ceil(0.35*iStep);
        let i = iStep/2;
        while ( i < width ) {
            let j = jStep/2;
            while (j < height ) {
                let start = pix2xy(i, j);
                // A piece of orbit on each side, so the curvature shows
                drawTools.integrate(start, nSteps, -1);
                portrait.lineWidth=1.5;
                let arc = [];
                drawTools.integrate(start, nSteps, 1, true, arc);
                portrait.lineWidth=1;
                drawArrowHead(arc);
                j = j+jStep;
            }
            i = i + iStep;
        }
    }

    function testEvalTime() {
        for (var i = 0; i < 100000; i++) {
            fModerated([xmin, ymin]);
        }
    }

    this.init = function( 
            portraitElement, 
            textOutElement, 
            xVarTxt,
            yVarTxt,
            params,
            fExprTxt,
            gExprTxt,
            region,
            titleTxtArg ) {
        xmin = region.xmin;
        xmax = region.xmax;
        ymin = region.ymin;
        ymax = region.ymax;

        // A missing or blank name falls back to the default, so that a
        // programmatic call gets the same title as the form does.
        titleTxt = (titleTxtArg === undefined || titleTxtArg === null)
            ? "" : String(titleTxtArg).trim();
        if (titleTxt === "") { titleTxt = "mysys"; }
        xVarName = xVarTxt;
        yVarName = yVarTxt;

        portraitElem = portraitElement;
        textOutElem = textOutElement;
        height = portraitElem.height-yOffset-bottomMargin;
        width = height; // square plot: the aspect is right for a square window.
                        // The right margin gets whatever is left over.
        pixWidth =(xmax - xmin) / width;
        pixHeight = (ymax - ymin) / height;
        portrait = portraitElem.getContext("2d");

        initDynSys(xVarTxt, yVarTxt, params, fExprTxt, gExprTxt); 

        portrait.clearRect(0, 0, portraitElem.width, portraitElem.height);
        drawTitle();
        drawAxisNames();
        drawCoords();
        initialDrawing();

        // Draw orbits or search fixed points on click
        portraitElem.addEventListener("click", actOnClick, false);
    };
}

