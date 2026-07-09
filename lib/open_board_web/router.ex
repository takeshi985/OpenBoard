defmodule OpenBoardWeb.Router do
  use OpenBoardWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {OpenBoardWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", OpenBoardWeb do
    pipe_through :browser

    get "/", PageController, :home

    live "/boards", BoardLive.Index, :index
    live "/boards/:slug", BoardLive.Show, :show
  end

  if Application.compile_env(:open_board, :dev_routes) do
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: OpenBoardWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
