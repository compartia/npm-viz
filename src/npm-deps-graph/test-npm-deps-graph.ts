import {NpmDepsGraph} from './npm-deps-graph'
import './npm-deps-graph'
import './test-npm-deps-graph.html'

declare function fixture<T>(element: string):T

describe('npm-deps-graph', function() {
    it('should be scaffolds with love', function(done) {
        var element = fixture<NpmDepsGraph>('BasicTestFixture');
        // assert.equal(element.myProperty, 'an application scaffolds with love');
        done()
    });
});
