defmodule OpenBoardWeb.Security.ClientRenderingTest do
  use ExUnit.Case, async: true

  @app_js Path.expand("../../../assets/js/app.js", __DIR__)

  test "remote cursor names are inserted as text rather than HTML" do
    source = File.read!(@app_js)

    assert source =~ "label.textContent = cursor.name"
    refute source =~ "cursorElement.innerHTML"
  end

  test "remote stroke identifiers are not interpolated into selectors" do
    source = File.read!(@app_js)

    refute source =~ ~S|querySelector(`path[data-stroke-id="${strokeId}"]`)|
  end
end
