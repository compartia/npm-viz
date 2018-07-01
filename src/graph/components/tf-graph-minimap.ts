
import "polymer/polymer.html";
import { customElement } from 'taktik-polymer-typescript';
import './tf-graph-minimap.html';
import { Minimap } from "../tf_graph_common/minimap";


@customElement('tf-graph-minimap')
export class MinimapElement extends Polymer.Element {
 

  /**
   * Initializes the minimap and returns a minimap object to notify when
   * things update.
   *
   * @param svg The main svg element.
   * @param zoomG The svg group used for panning and zooming the main svg.
   * @param mainZoom The main zoom behavior.
   * @param maxWAndH The maximum width/height for the minimap.
   * @param labelPadding Padding in pixels due to the main graph labels.
   */
  public init(svg, zoomG, mainZoom, maxWAndH, labelPadding) {
    return new Minimap(svg, zoomG, mainZoom, this, maxWAndH, labelPadding);
  }
}
 
